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
import GraphQLByteString from './customTypes/GraphQLByteString';
import { pubsub } from './subscriptions';
import { opcua, nextSession, handleError } from './opcua';
import opcObserver from './opcua-observer';


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

const get = name=> ({ id }) =>
      getWholeAttribute(id, opcua.AttributeIds[name])
        .map(v => ({ ...v, value: v.value && v.value.value })).toPromise();
const getReferences = ({ nodeId, args }) => {
  const {
    referenceTypeId,
    browseDirection = 0,
    nodeClasses = [255],
    includeSubtypes,
    results,
  } = args;
  const browseDescription = {
    nodeId,
    referenceTypeId,
    browseDirection,
    includeSubtypes,
    nodeClassMask: nodeClasses ? nodeClasses.reduce(((p, c)=>p | c), 0) : 0,
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
    callMethod(_, { id, methodId }) {
      const methodsToCall = [{
        objectId: id,
        methodId,
      }];
      return new Promise(function(resolve, reject){
        try{
          nextSession().take(1).subscribe(session=>
            session.call(methodsToCall, function(err, results) {
              if (!err) {
                if (results[0].statusCode.value) {
                  reject(results[0].statusCode);
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
    updateNode(_, { id, value: { value, dataType } }) {
      return new Promise(function(resolve, reject){
        try{
          nextSession().take(1).subscribe(session=>
            session.writeSingleNode(id, new opcua.Variant({ dataType, value }), function(err, result) {
              console.log('updated node', err, result)
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
            return 'UaFloat';
          case 'ByteString':
            return 'UaByteString';
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
    dataType: get('DataType'),
    valueRank: get('ValueRank'),
    arrayDimensions({ id }) { return getAttribute(id, opcua.AttributeIds.ArrayDimensions).toPromise(); },
    accessLevel: get('AccessLevel'),
    userAccessLevel: get('UserAccessLevel'),
    minimumSamplingInterval: get('MnimumSamplingInterval'),
    historizing: get('Historizing'),
    executable: get('Executable'),
    userExecutable: get('UserExecutable:'),
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
