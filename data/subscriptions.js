import { PubSub, SubscriptionManager } from 'graphql-subscriptions';
import schema from './schema';
import opcObserver from './opcua-observer';


const valueSubscriptions = {};
const valueSubscriptionCounters = {};
const valueSubscriptionIds = {};


// this class extends the apollo pub sub to intercept subscribe and unsubscribes

class MyPubSub extends PubSub {

  subscribe(trigger, onMessage, channelOptions, variables) {
    const ret = super.subscribe(trigger, onMessage);
    console.log('subscribed to:', trigger, variables, variables && valueSubscriptionCounters[variables.id]);
    if (trigger === 'value') {
      valueSubscriptionCounters[variables.id] = (valueSubscriptionCounters[variables.id] || 0) + 1;
      return new Promise((resolve) => {
        ret.then((f) => {
          const nodeId = variables.id;
          valueSubscriptionIds[f] = nodeId;
          if (valueSubscriptionCounters[nodeId] === 1) {
            valueSubscriptions[nodeId] = opcObserver({ nodeId }).subscribe((v) => {
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
    const nodeId = valueSubscriptionIds[subid];
    delete valueSubscriptionIds[subid];
    if (nodeId) {
      valueSubscriptionCounters[nodeId] -= 1;
      if (!valueSubscriptionCounters[nodeId]) {
        console.log('unsubscribing fully from:', nodeId);
        valueSubscriptions[nodeId].unsubscribe();
        delete valueSubscriptions[nodeId];
        delete valueSubscriptionCounters[nodeId];
      } else {
        console.log('unsubscribing from:', nodeId);
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
