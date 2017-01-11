import { PubSub, SubscriptionManager } from 'graphql-subscriptions';
import schema from './schema';
import opcObserver from './opcua-observer';
import opcPoller from './opcua-poller';
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
    const ret = super.subscribe(trigger, onMessage);
    let attributeId;
    let observer;
    if (trigger === 'value') {
      attributeId = opcua.AttributeIds.Value;
      observer = opcObserver;
    }
    if (trigger === 'executable') {
      attributeId = opcua.AttributeIds.Executable;
      observer = opcPoller;
    }

    if (args) {
      const { id: nodeId } = args;
      valueSubscriptionCounters[attributeId] = valueSubscriptionCounters[attributeId] || {};
      valueSubscriptions[attributeId] = valueSubscriptions[attributeId] || {};

      valueSubscriptionCounters[attributeId][nodeId] = (valueSubscriptionCounters[attributeId][nodeId] || 0) + 1;
      return new Promise((resolve) => {
        ret.then((f) => {
          valueSubscriptionIds[f] = { nodeId, attributeId };
          if (valueSubscriptionCounters[attributeId][nodeId] === 1) {
            valueSubscriptions[attributeId][nodeId] = observer({ nodeId, attributeId }).subscribe((v) => {
              resolve(f);
              this.publish(trigger, v);
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
          valueSubscriptions[attributeId][nodeId].unsubscribe();
          delete valueSubscriptions[attributeId][nodeId];
          delete valueSubscriptionCounters[attributeId][nodeId];
        } else {
          
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
