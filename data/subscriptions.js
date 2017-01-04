import { PubSub, SubscriptionManager } from 'graphql-subscriptions';
import schema from './schema';
import opcObserver from './opcua-observer';
import { opcua } from './opcua';


const valueSubscriptions = {};
const valueSubscriptionCounters = {};
const valueSubscriptionIds = {};


// this class extends the apollo pub sub to intercept subscribe and unsubscribes

class MyPubSub extends PubSub {

  subscribe(
    trigger,
    onMessage,
    channelOptions,
    args
  ) {
    console.log('subscribing', args);
    
    const ret = super.subscribe(trigger, onMessage);
    if (trigger === 'value' && args) {
      console.log('subscribed to:', trigger, nodeId, nodeId && valueSubscriptionCounters[attributeId][nodeId]);
      const { id: nodeId, attributeId = opcua.AttributeIds.Value } = args;
      valueSubscriptionCounters[attributeId] = valueSubscriptionCounters[attributeId] || {};
      valueSubscriptions[attributeId] = valueSubscriptions[attributeId] || {};

      valueSubscriptionCounters[attributeId][nodeId] = (valueSubscriptionCounters[attributeId][nodeId] || 0) + 1;
      return new Promise((resolve) => {
        ret.then((f) => {
          valueSubscriptionIds[f] = { nodeId, attributeId };
          if (valueSubscriptionCounters[attributeId][nodeId] === 1) {
            valueSubscriptions[attributeId][nodeId] = opcObserver({ nodeId, attributeId }).subscribe((v) => {
              resolve(f);
              this.publish('value', v);
            });
          } else {
            resolve(f);
          }
        });
      });
    }
    return ret;
  }
  unsubscribe(subid) {
    if (valueSubscriptionIds[subid]) {
      const { nodeId, attributeId } = valueSubscriptionIds[subid];
      delete valueSubscriptionIds[subid];
      if (nodeId) {
        valueSubscriptionCounters[attributeId][nodeId] -= 1;
        if (!valueSubscriptionCounters[attributeId][nodeId]) {
          console.log('unsubscribing fully from:', { nodeId, attributeId });
          valueSubscriptions[attributeId][nodeId].unsubscribe();
          delete valueSubscriptions[attributeId][nodeId];
          delete valueSubscriptionCounters[attributeId][nodeId];
        } else {
          console.log('unsubscribing from:', { nodeId, attributeId });
        }
      }
    }
    return super.unsubscribe(subid);
  }

}
const pubsub = new MyPubSub();


const subscriptionManager = new SubscriptionManager({
  schema,
  pubsub,
});


const subsubscribe = subscriptionManager.subscribe;
subscriptionManager.subscribe = function (options) {
  const ret = subsubscribe.bind(subscriptionManager)(options);
  return ret;
};


export { subscriptionManager, pubsub };
