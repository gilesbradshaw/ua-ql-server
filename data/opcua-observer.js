
import Rx from 'rxjs';
import { opcua, nextSession, handleError } from './opcua';


const opcuaObserver = ({ nodeId, attributeId = opcua.AttributeIds.Value }) =>
  nextSession().map(session =>
    new opcua.ClientSubscription(session, {
      requestedPublishingInterval: 1000,
      requestedLifetimeCount: 10,
      requestedMaxKeepAliveCount: 2,
      maxNotificationsPerPublish: 10,
      publishingEnabled: true,
      priority: 10,
    })
  ).switchMap(subscriber => Rx.Observable.create((observer) => {
    const m = subscriber.monitor(
      {
        nodeId,
        attributeId,
      },
      {
        samplingInterval: 1000,
        discardOldest: true,
        queueSize: 10,
      },
      opcua.read_service.TimestampsToReturn.Both,
      err => console.log('monitoring...', err)
    );
    m.on('changed', (value) => {
      observer.next({ id: nodeId, value });
    });
    return () => m.terminate();
  }));

export default opcuaObserver;
