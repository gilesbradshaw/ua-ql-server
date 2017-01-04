import { find, filter } from 'lodash';
import Rx from 'rxjs';
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
        console.log(results)
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
        console.log(results)
        return results && results[0] && results[0].value;
      }
    )([{ nodeId, attributeId }])
  );
};

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
          console.log('refs:', JSON.stringify(browseResult, null, 2), err);
          // mystifid re nodeClass
          return browseResult[0].references.map(r=>({ ...r, id: `${nodeId}->${r.referenceTypeId}->${r.nodeId}`, nodeClass: r.nodeClass }))
        }
      )(browseDescription)
    );
};

const resolveFunctions = {
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
  },
  Subscription: {
    postUpvoted(post, { id }) {
      if (post.id === id) {
        return post;
      }
    },
    value(value, { id }) {
      if(value.id === id) {
        return { id, dataValue: value.value, statusCode: value.statusCode };
      }
    },
  },
  TestUnion: {
    __resolveType(obj, context, info){
      const { $dataType: { key: dKey }, $arrayType: { key: aKey }} = obj
      switch (aKey) {
        case 'Scalar':
          switch (dKey) {
            case 'Int32':
              return 'UaInt';
            case 'Int16':
              return 'UaInt';
            case 'UInt32':
              return 'UaInt';
            case 'UInt16':
              return 'UaInt';
            case 'String':
              return 'UaString';
          }
        case 'Array':
          switch (dKey) {
            case 'Int32':
              return 'UaIntArray';
            case 'Int16':
              return 'UaIntArray';
            case 'UInt32':
              return 'UaIntArray';
            case 'UInt16':
              return 'UaIntArray';
            case 'String':
              return 'UaStringArray';
          }
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
      return { id: `ns=${namespace};i=${value}` };
    },
  },
  UaNode: {
    nodeId({ id }) { return getAttribute(id, opcua.AttributeIds.NodeId).toPromise(); },
    browseName({ id }) { return getAttribute(id, opcua.AttributeIds.BrowseName).toPromise(); },
    displayName({ id }) { return getAttribute(id, opcua.AttributeIds.DisplayName).toPromise(); },
    description({ id }) { return getAttribute(id, opcua.AttributeIds.Description).toPromise(); },
    writeMask({ id }) { return getAttribute(id, opcua.AttributeIds.WriteMask).toPromise(); },
    userWriteMask({ id }) { return getAttribute(id, opcua.AttributeIds.UserWriteMask).toPromise(); },
    isAbstract({ id }) { return getAttribute(id, opcua.AttributeIds.IsAbstract).toPromise(); },
    symmetric({ id }) { return getAttribute(id, opcua.AttributeIds.Symmetric).toPromise(); },
    inverseName({ id }) { return getAttribute(id, opcua.AttributeIds.InverseName).toPromise(); },
    containsNoLoops({ id }) { return getAttribute(id, opcua.AttributeIds.ContainsNoLoops).toPromise(); },
    eventNotifier({ id }) { return getAttribute(id, opcua.AttributeIds.EventNotifier).toPromise(); },
    dataValue({ id }) { return getWholeAttribute(id, opcua.AttributeIds.Value).toPromise(); },
    dataType({ id }) { return getAttribute(id, opcua.AttributeIds.DataType).toPromise(); },
    valueRank({ id }) { return getAttribute(id, opcua.AttributeIds.ValueRank).toPromise(); },
    arrayDimensions({ id }) { return getAttribute(id, opcua.AttributeIds.ArrayDimensions).toPromise(); },
    accessLevel({ id }) { return getAttribute(id, opcua.AttributeIds.AccessLevel).toPromise(); },
    userAccessLevel({ id }) { return getAttribute(id, opcua.AttributeIds.UserAccessLevel).toPromise(); },
    minimumSamplingInterval({ id }) { return getAttribute(id, opcua.AttributeIds.MinimumSamplingInterval.ArrayDimensions).toPromise(); },
    historizing({ id }) { return getAttribute(id, opcua.AttributeIds.Historizing).toPromise(); },
    executable({ id }) { return getAttribute(id, opcua.AttributeIds.Executable).toPromise(); },
    userExecutable({ id }) { return getAttribute(id, opcua.AttributeIds.UserExecutable).toPromise(); },
    outputArguments({ id }) { return getAttribute(id, opcua.AttributeIds.OutputArguments).toPromise(); },
    references({ id: nodeId }, args) {
      return getReferences({ nodeId, args }).toPromise();
    },
    /*
    arrayDimensions: getProperty(new GraphQLList(GraphQLInt), opcua.AttributeIds.ArrayDimensions), //16,  IntListResultType
    accessLevel: getProperty(GraphQLInt, opcua.AttributeIds.AccessLevel), //17,
    userAccessLevel: getProperty(GraphQLInt, opcua.AttributeIds.UserAccessLevel), //18,
    minimumSamplingInterval: getProperty(GraphQLFloat, opcua.AttributeIds.MinimumSamplingInterval), //19,
    historizing: getProperty(GraphQLBoolean, opcua.AttributeIds.Historizing), //20,
    executable: getProperty(GraphQLBoolean, opcua.AttributeIds.Executable), //21,
    userExecutable: getProperty(GraphQLBoolean, opcua.AttributeIds.UserExecutable), //22,
    */
    //outputArguments: {type: new GraphQLList(ArgumentValueType)},
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
