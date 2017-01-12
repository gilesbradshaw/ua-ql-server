'use strict';

import opcua from 'node-opcua';
import Rx from 'rxjs';

const endpointUrl = 'opc.tcp://opcua.demo-this.com:51210/UA/SampleServer';


function logAllEmitterEvents(eventEmitter) {
  const emitToLog = eventEmitter.emit;

  eventEmitter.emit = function () {
      var event = arguments[0];
      if(event!='receive_response' && event!='receive_chunk' && event!='send_request' && event!='send_chunk')
      emitToLog.apply(eventEmitter, arguments);
  };
  return eventEmitter;
}


//opc.tcp://opcserver.mAutomation.net:4841  mFactor Engineering
//opc.tcp://commsvr.com:51234/UA/CAS_UA_Server  CommServer
//opc.tcp://uademo.prosysopc.com:53530/OPCUA/ prosys OPC
//opc.tcp://opcua.demo-this.com:51210/UA/SampleServer opclabs
//opc.tcp://opcua.demo-this.com:51211/UA/SampleServer opclabs
//opc.tcp://opcua.demo-this.com:51212/UA/SampleServer opclabs
//opc.tcp://demo.ascolab.com:4841


class UASession {
  constructor() {
    const _this = this;
    var observable = new Rx.ReplaySubject(1);
    var closeRequest = new Rx.Subject();
    var options = {
      applicationName: 'uaQL',
      certificateFile : "./certificates/client_selfsigned_cert_2048.pem",
      privateKeyFile: "./certificates/client_key_2048.pem",
      connectionStrategy: {
        maxRetry: 3,
        initialDelay: 1000,
        maxDelay: 10000},
      keepSessionAlive: true
    };
    // logAllEmitterEvents(
    var client = new opcua.OPCUAClient(options);
    this.sessions = observable;
    this.nextSession=()=> observable.filter(s=>s).take(1)
    this.handleError=(session, err)=>{
      try{
        //if(err instanceof Error){
          console.log('err details', err.name, err.message);
          if(err.message==='Transaction has timed out'){
            console.log('closing request', session);
            closeRequest.next(session);
          }
        //} else {
          console.log('err not instanceof Error');
          if(err){
            console.log('err');
            if(err.response)
            {
              console.log('err.response');
              if(err.response.responseHeader)
              {
                console.log('err.response.responseHeader');
                if(err.response.responseHeader.serviceResult)
                {
                  console.log('err.response.responseHeader.serviceResult');
                  console.log('name:', err.response.responseHeader.serviceResult.name);
                }
              }
            }
          }
          if(err
            && err.response
            && err.response.responseHeader
            && err.response.responseHeader.serviceResult
            && err.response.responseHeader.serviceResult.name === 'BadSessionClosed'){
            console.log('closing request', session);
            closeRequest.next(session);
          }
        //}
      } catch(ex) {
        console.log('ERRRRRRRRRRRRRRRRRRRRRRRR:', ex);
      }
      
      return err;
    }
    const go = ()=> {
      console.log('ok connecting client..');
      client.connect(endpointUrl, (err) => {
        if(err) {
          go();
        }
        if(!err){
          console.log('connected');
          console.log('creating session..');
          client.createSession( function(err, session) {
            //mmm try disconnecting the client when the session gets a fail

            if(err) {
              console.log('failed to create session', err);
              go();
            }
            else {
              console.log('session created');
              observable.next(session);
            
              const sessionCloser = closeRequest.filter(s=> {
                  console.log('close request seen but..', s===session);
                  return s===session;

              }


                ).take(1).subscribe(()=>{
                console.log('session closer...');
                observable.take(1).filter(s=>s).subscribe(()=> {
                  observable.next(false);
                  console.log('CLOSE REQUEST FROM SESSION');
                  //client.closeSession(session, ()=>{
                    //console.log('session closed');
                    client.disconnect(()=>{
                      console.log('client disconnected');
                      //go();
                    });
                  //});
                  
                });
              });


              console.log('Created session', new Date());

              client.once('timed_out_request', (data) => {
                  console.log('timedout request', JSON.stringify(data));
              });
              client.once('close', ()=>{
                sessionCloser.dispose();
                observable.next(false);
                console.log("client closed");
                client.closeSession(session, ()=>{
                  client.disconnect(()=>{
                    console.log("session closed");
                    go();
                });
              });
            });
              
            }
          });
        }
      });
    };
    go();

  }
}

const options = {
  applicationName: 'uaQL',
  certificateFile: './certificates/client_selfsigned_cert_2048.pem',
  privateKeyFile: './certificates/client_key_2048.pem',
  connectionStrategy: {
    maxRetry: 0,
    initialDelay: 1000,
    maxDelay: 10000,
  },
  keepSessionAlive: true,
};
    // logAllEmitterEvents(
const client = new opcua.OPCUAClient(options);
const connects = Rx.Observable.bindCallback(client.connect.bind(client));



const c = () => connects(endpointUrl).switchMap((err) => {
  if (err) {
    console.log(err);
    return c();
  }
  return Rx.Observable.of(client);
});

c()
  .switchMap(cl => Rx.Observable.bindNodeCallback(cl.createSession.bind(client))())
  .switchMap(session => Rx.Observable.create(obs => {
    obs.next(session);
    session.once('close', () => obs.error('session closed....'));
    client.once('timed_out_request', (data) => {
        console.log('timedout request', JSON.stringify(data));
        obs.error('session closed....');
    });
    return () => {
      console.log('unsubscribing look giles!');
    };
  }))
  //.takeUntil(Rx.Observable.timer(5000))
  //.concat(Rx.Observable.throw('oh my God!!!'))
  .takeUntil(Rx.Observable.bindCallback(client.once.bind(client))('close'))
  .subscribe(
    session => console.log('connected!', session),
    err => console.log('error received:::', err),
    () => console.log('complete')
  );





const connector = new UASession();
const nextSession = connector.nextSession;
const handleError = connector.handleError;
const sessions = connector.sessions;
//export default connector.session;
export {opcua as opcua, sessions as sessions, nextSession as nextSession, handleError as handleError};
