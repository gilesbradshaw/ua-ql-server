import { find, filter } from 'lodash';
import Rx from 'rxjs';
import CustomGraphQLDateType from 'graphql-custom-datetype';
import {
  GraphQLEmail,
  GraphQLURL,
  GraphQLDateTime,
  GraphQLLimitedString,
  GraphQLPassword,
  GraphQLUUID
} from 'graphql-custom-types';
import GraphQLJSON from 'graphql-type-json';
import GraphQLByteString from './customTypes/GraphQLByteString';
import { pubsub } from './subscriptions';
import { opcua, nextSession, handleError } from './opcua';
import { resolveNodeId } from 'node-opcua';
import opcObserver from './opcua-observer';

let commandCount=0;

const authors = [
  { id: 1, firstName: 'Tom', lastName: 'Coleman' },
  { id: 2, firstName: 'Sashko', lastName: 'Stubailo' },
];

const posts = [
  { id: 1, authorId: 1, title: 'Introduction to GraphQL', votes: 2 },
  { id: 2, authorId: 2, title: 'GraphQL Rocks', votes: 3 },
  { id: 3, authorId: 2, title: 'Advanced GraphQL', votes: 1 },
];

const getAttribute = (nodeId, attributeId) => {
  return nextSession()
  .take(1)
  .flatMap(session =>
    Rx.Observable.bindCallback(
      session.read.bind(session),
      (err, _nodesToRead, results) =>{
        return results && results[0] && results[0].value && results[0].value.value;
      }
        
    )([{ nodeId, attributeId }])
  );
};
const getWholeAttribute = (nodeId, attributeId) => {
  return nextSession()
  .take(1)
  .flatMap(session =>
    Rx.Observable.bindCallback(
      session.read.bind(session),
      (err, _nodesToRead, results) => {
        if (err) throw (err);
        const v = results && results[0];
        return v;
      }
    )([{ nodeId, attributeId }])
  );
};

const browsePath = ({id}, args) => new Promise(function(resolve, reject){
  console.log('gettg b paths', id, args)
  nextSession().take(1)
    //.timeout(3000, new Error('Timeout, try later...'))
    .subscribe(session=> {
    const bpath= [{
      startingNode: resolveNodeId(id),
      relativePath: { 
        elements: args.paths.map((p,i)=>({
          targetName: {
            namespaceIndex: p.split(':')[1] || 0,
            name: p.split(':')[0]
          },
          referenceTypeId: args.types[i],
          isInverse: !!args.isInverses[i],
          includeSubtypes: true //!!args.subTypes[i],
        }))
      }
    }];
    try{
      session.translateBrowsePath(bpath, (err, x) => {
        console.log('somethng back!!!!!', JSON.stringify(x), err)
        if(!err) {
          if(x[0]) {
            if(x[0].targets) {
              if(x[0].targets[0])
                resolve({id: x[0].targets[0].targetId});
                return;
            }
          }
          resolve(null);
        } else {
          reject(err);
        }
      });
    } catch (ex) {
      console.log(ex);
    }
    
  }, reject);
})

const getArguments = ({ nodeId }) => {
  console.log('gettijg ', nodeId)
  return nextSession()
  .take(1)
  .flatMap(session =>
    Rx.Observable.bindCallback(
      session.getArgumentDefinition.bind(session),
      (err, inputArguments, outputArguments) => {
        if (err) throw (err);
        return {
          inputArguments: inputArguments.map(i =>( {...i, dataType: {id: i.dataType}})), outputArguments };
      }
    )(resolveNodeId(nodeId))
  );
};

const get = name=> ({ id }) =>
      getWholeAttribute(id, opcua.AttributeIds[name])
        .map(v => ({ ...v, value: v.value && v.value.value })).toPromise();
const getReferences = ({ nodeId, args }) => {
  const {
    referenceTypeId,
    browseDirection = 'Both',
    nodeClasses,
    includeSubtypes,
    results,
  } = args;
  const nodeClassMask = nodeClasses ? nodeClasses.map(c => {
    switch (c) {
      case 'Unspecified':
        return 0;
      case 'Object':
        return 1;
      case 'Variable':
        return 2;
      case 'Method':
        return 4;
      case 'ObjectType':
        return 8;
      case 'VariableType':
        return 16;
      case 'ReferenceType':
        return 32;
      case 'DataType':
        return 64;
      case 'View':
        return 128;
      default:
        return 0;
    }
  }).reduce(((p, c) => p | c), 0) : 255;
  const browseDescription = {
    nodeId,
    referenceTypeId,
    browseDirection,
    includeSubtypes: includeSubtypes || undefined,
    nodeClassMask,
    //nodeClassMask: nodeClasses ? nodeClasses.reduce(((p, c)=>p | c), 0) : 0,
    resultMask: results ? results.reduce(((p, c)=>p | c), 0) : 63,
  };
  
  return nextSession()
    .take(1)
    .flatMap(session =>
      Rx.Observable.bindCallback(
        session.browse.bind(session),
        (err, browseResult) => {
          // mystifid re nodeClass
          return { 
            ...browseResult[0], 
            references: browseResult[0].references
              .map(r=>({ ...r, id: `${nodeId}->${r.referenceTypeId}->${r.nodeId}`, nodeClass: r.nodeClass }))
          };
        }
      )(browseDescription)
    );
};

const resolveFunctions = {
  CustomGraphQLDateType,
  GraphQLUUID,
  GraphQLDateTime,
  GraphQLByteString,
  JSON: GraphQLJSON,
  Query: {
    post(_, ok) {
      const { id } = ok;
      return posts.find(p => p.id === id);
    },
    uaNode(_, { id }) {
      return { id };
    },
    posts() {
      return new Promise((resolve) => {
        nextSession().take(1).subscribe((session) => {
          const nodesToRead = [{ nodeId: 'ns=0;i=85', attributeId: 5 }];
          session.read(nodesToRead, function(err, _nodesToRead, results) {
            resolve(posts);
          });
        });
      });
    },
    authors() {
      return new Promise(resolve => resolve(authors));
    },
  },
  Mutation: {
    upvotePost(_, { postId }) {
      const post = find(posts, { id: postId });
      if (!post) {
        throw new Error(`Couldn't find post with id ${postId}`);
      }
      post.votes += 1;
      pubsub.publish('postUpvoted', post);
      return post;
    },
    callMethod(_, arg) {
      const { id, methodId, inputArguments} = arg;
      console.log('call', inputArguments);
      console.log('gah', arg);
      const methodsToCall = [{
        objectId: id,
        methodId,
        inputArguments: inputArguments.map(a => new opcua.Variant({ dataType: opcua.DataType[a.dataType], value: a.value }))
      }];
      return new Promise(function(resolve, reject){
        try{
          nextSession().take(1).subscribe(session=>
            session.call(methodsToCall, function(err, results) {
              if (!err) {
                console.log('result', JSON.stringify(results, null, 2));
                if (results[0].statusCode.value) {
                  reject(results[0].statusCode);
                } else {
                  console.log('args gonna be', inputArguments);
                  commandCount++;
                  resolve({ 
                    id: methodId, 
                    commandCount,
                    outputArgument: {
                      index: 0,
                      dataType: 'ahh',
                      arrayType: '0ooo',
                      value: 1
                    },
                    outArguments: [{
                      index: 0,
                      dataType: 'ahh',
                      arrayType: '0ooo',
                      value: 4,
                    }]
                  });
                }
              } else {
                reject(err);
              }
            }),
            reject
          );
        }
        catch(err){
            reject(err);
        }    
      });
    },
    updateNode(_, { id, value: { value, dataType, arrayType } }) {
      return new Promise(function(resolve, reject){
        try{
          nextSession().take(1).subscribe(session=>
            session.writeSingleNode(id, new opcua.Variant({ 
              dataType,
              arrayType: opcua.VariantArrayType[arrayType],
              value,
             }), function(err, result) {
              if (!err) {
                if (result.value) {
                  reject(result);
                } else {
                  resolve({ id });
                }
              } else {
                reject(err);
              }
            }),
            reject
          );
        }
        catch(err){
            reject(err);
        }    
      });
    },
  },
  Subscription: {
    postUpvoted(post, { id }) {
      if (post.id === id) {
        return post;
      }
      return null;
    },
    value(value, { id }) {
      if (value.id === id) {
        return { id, dataValue: value.value, statusCode: value.statusCode };
      }
      return null;
    },
    executable(executable, { id }) {
      if (executable.id === id) {
        return { id, executable: executable.value, statusCode: executable.statusCode };
      }
      return null;
    },
  },
  DataValueUnion: {  
    __resolveType(obj, context, info) {
      const { $dataType: { key: dKey }, $arrayType: { key: aKey }} = obj
        
      const getType = _d => {
        switch (dKey) {
          case 'Int32':
            return 'UaInt';
          case 'Int16':
            return 'UaInt';
          case 'UInt32':
            return 'UaInt';
          case 'UInt16':
            return 'UaInt';
          case 'SByte':
            return 'UaInt';
          case 'Int64':
            return 'UaLong';

          case 'String':
            return 'UaString';
          case 'Boolean':
            return 'UaBoolean';
          case 'Guid':
            return 'UaGuid';
          case 'DateTime':
            return 'UaDate';
          case 'Float':
            return 'UaFloat';
          case 'Double':
            return 'UaDouble';
          case 'ByteString':
            return 'UaByteString';
          case 'LocalizedText':
            return 'UaLocalizedText';
          case 'QualifiedName':
            return 'UaQualifiedName';
          case 'XmlElement':
            return 'UaXmlElement';
          case 'StatusCode':
            return 'StatusCode';
          case 'NodeId':
            return 'UaNodeId';
          case 'ExpandedNodeId':
            return 'UaExpandedNodeId';
          default:
            return null;
        }
      };
      
      switch (aKey) {
        case 'Scalar':
          return getType(dKey);
        case 'Array':
          return `${getType(dKey)}Array`;
        default:
          return null;
      }
    },
  },
  ExpandedNodeId: {
    uaNode({
      identifierType,
      value,
      namespace,
      namespaceUri,
      serverIndex 
    }) {
      // needs sorting
      return { id: `ns=${namespace};i=${value}` };
    },
  },
  UaNode: {
    nodeId: get('NodeId'),
    browseName: get('BrowseName'),
    displayName: get('DisplayName'),
    description: get('Description'),
    writeMask: get('WriteMask'),
    userWriteMask: get('UserWriteMask'),
    isAbstract: get('IsAbstract'),
    symmetric: get('Symmetric'),
    inverseName: get('InverseName'),
    containsNoLoops: get('ContainsNoLoops'),
    eventNotifier: get('EventNotifier'),
    dataValue({ id }) {
      return getWholeAttribute(id, opcua.AttributeIds.Value)
        .map(v => { 
          return ({
          ...v,
          dataType: v.value.$dataType.key,
          arrayType: v.value.$arrayType.key,
        })}
        ).toPromise();
    },
    browsePath,
    dataType: get('DataType'),
    valueRank: get('ValueRank'),
    arrayDimensions({ id }) { return getAttribute(id, opcua.AttributeIds.ArrayDimensions).toPromise(); },
    accessLevel: get('AccessLevel'),
    userAccessLevel: get('UserAccessLevel'),
    minimumSamplingInterval: get('MnimumSamplingInterval'),
    historizing: get('Historizing'),
    executable: get('Executable'),
    userExecutable: get('UserExecutable:'),
    arguments: ({ id: nodeId }) => getArguments({ nodeId }).toPromise(),
    outputArguments({ id }) { return getAttribute(id, opcua.AttributeIds.OutputArguments).toPromise(); },
    references({ id: nodeId }, args) {
      return getReferences({ nodeId, args }).toPromise();
    },
    nodeClass(node) {
      return getAttribute(node.id, opcua.AttributeIds.NodeClass)
        .map((c) => {
          switch (c) {
            case 0:
              return 'Unspecified';
            case 1:
              return 'Object';
            case 2:
              return 'Variable';
            case 4:
              return 'Method';
            case 8:
              return 'ObjectType';
            case 16:
              return 'VariableType';
            case 32:
              return 'ReferenceType';
            case 64:
              return 'DataType';
            case 128:
              return 'View';

          }
          return null;
        })
        .toPromise();
    },
    self(node) {
      return node;
    },
  },
  Author: {
    posts(author) {
      return filter(posts, { authorId: author.id });
    },
  },
  Post: {
    author(post) {
      return find(authors, { id: post.authorId });
    },
  },
};


//opcObserver('ns=2;i=10932').subscribe(v => pubsub.publish('value', v));

export default resolveFunctions;
