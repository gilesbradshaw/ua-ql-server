
import Rx from 'rxjs';
import { opcua, nextSession, handleError } from './opcua';


const opcuaPoller = ({ nodeId, attributeId = opcua.AttributeIds.Value }) =>
  nextSession().switchMap(session =>
    Rx.Observable.timer(1000, 1000).switchMap(
      () => Rx.Observable.bindCallback(
        session.read.bind(session),
        (err, _nodesToRead, results) => results
      )([{
        nodeId,
        attributeId,
      }]).map((value) => {
        return ({ id: nodeId, value: value[0] });
      })
    )
  );

export default opcuaPoller;
