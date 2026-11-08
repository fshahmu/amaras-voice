import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import worker from '../src/Index.js';

const root = 'https://test.example';
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey); jwk.kid = 'test';
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function token(overrides = {}) {
  const now = Math.floor(Date.now()/1000);
  const input = encode({ alg: 'RS256', kid: 'test' }) + '.' + encode({ iss: 'https://team.cloudflareaccess.com', aud: ['test-aud'], sub: 'test-user', iat: now, exp: now + 300, ...overrides });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input));
  return input + '.' + Buffer.from(signature).toString('base64url');
}
let paid = 0, limited = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (url.endsWith('/certs')) return Response.json({ keys: [jwk] });
  assert.equal(url, 'https://api.openai.com/v1/realtime/client_secrets');
  const body = JSON.parse(init.body);
  assert.equal(body.expires_after.seconds, 60);
  assert.equal(body.session.type, 'realtime');
  assert.equal(body.session.max_output_tokens, 512);
  paid++; return Response.json({ value: 'ek_mock' });
};
const env = { OPENAI_API_KEY: 'fake-server-key', CF_ACCESS_AUD: 'test-aud', CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', AMARA_RATE_LIMITER: { limit: async () => { limited++; return { success: true }; } }, ASSETS: { fetch: async () => new Response('portrait-page') } };
const jwt = await token();
const req = (path = '/session', method = 'POST', assertion = jwt, origin = root) => new Request(root + path, { method, headers: { ...(origin && { Origin: origin }), ...(assertion && { 'Cf-Access-Jwt-Assertion': assertion }) } });
assert.equal(await (await worker.fetch(req('/', 'GET'), env)).text(), 'portrait-page');
assert.equal((await worker.fetch(req('/session','POST',null),env)).status,401);
assert.equal((await worker.fetch(req('/session','POST',jwt,'https://evil.example'),env)).status,403);
assert.equal((await worker.fetch(req('/session','POST',await token({aud:['wrong']})),env)).status,401);
assert.equal((await worker.fetch(req('/session','POST',await token({exp:1})),env)).status,401);
assert.equal(paid,0);
assert.equal((await worker.fetch(req('/api/voice-status','GET',jwt,null),env)).status,200);
assert.equal(paid,0); assert.equal(limited,0);
assert.equal((await worker.fetch(req('/api/voice-status','GET',jwt,null),{...env,OPENAI_API_KEY:undefined})).status,503);
assert.equal((await worker.fetch(req(),env)).status,200); assert.equal(paid,1);
assert.equal((await worker.fetch(req(),{...env,AMARA_RATE_LIMITER:{limit:async()=>({success:false})}})).status,429); assert.equal(paid,1);
assert.equal((await worker.fetch(req(),{...env,AMARA_RATE_LIMITER:{limit:async()=>{throw Error('offline')}}})).status,503); assert.equal(paid,1);
globalThis.fetch = realFetch;
console.log('PASS backend assets, signed authentication, expiry/audience rejection, readiness without paid calls, rate limiting and fail-closed errors');

const script = await readFile(new URL('../public/voice.js', import.meta.url), 'utf8');
function client({ readiness = 200, delayedMic = false, delayedSession = false } = {}) {
  const elements = new Map();
  const element = () => ({ disabled:false, hidden:false, textContent:'', setAttribute(name,value){this[name]=value}, pause(){}, play(){return Promise.resolve()}, remove(){} });
  for(const id of ['status','voiceHelp','connectVoice','endVoice','muteVoice','playVoice','stop','speak']) elements.set(id,element());
  const track = { enabled:true, stopped:false, stop(){this.stopped=true} };
  const stream = {getTracks:()=>[track],getAudioTracks:()=>[track]};
  let micCalls=0, sessionCalls=0, resolveMic, resolveSession;
  const handlers = {};
  class Peer {
    constructor(){this.connectionState='new'}
    addTrack(){}
    createDataChannel(){this.dc={close(){},readyState:'open'};return this.dc}
    async createOffer(){return {type:'offer',sdp:'mock-offer'}}
    async setLocalDescription(offer){this.localDescription=offer}
    async setRemoteDescription(){this.connectionState='connected';this.dc.onopen()}
    close(){this.closed=true}
  }
  const context = vm.createContext({document:{getElementById:id=>elements.get(id),createElement:element,body:{append(){}}},window:{isSecureContext:true,RTCPeerConnection:Peer,addEventListener:(name,fn)=>{handlers[name]=fn}},navigator:{mediaDevices:{getUserMedia:()=>{micCalls++;return delayedMic?new Promise(resolve=>{resolveMic=resolve}):Promise.resolve(stream)}}},RTCPeerConnection:Peer,AbortController,setTimeout,clearTimeout,MediaStream:class {},fetch:async url=>{
    if(url==='/api/voice-status')return new Response('{}',{status:readiness,headers:{'Content-Type':'application/json'}});
    if(url==='/session'){sessionCalls++;if(delayedSession)return new Promise(resolve=>{resolveSession=resolve});return Response.json({client_secret:{value:'ek_mock'}})}
    assert.equal(url,'https://api.openai.com/v1/realtime/calls');return new Response('mock-answer');
  }});
  vm.runInContext(script,context);
  return {elements,track,handlers,stream,get micCalls(){return micCalls},get sessionCalls(){return sessionCalls},releaseMic:()=>resolveMic(stream),releaseSession:()=>resolveSession(Response.json({client_secret:{value:'ek_mock'}}))};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let c=client({readiness:503});await c.elements.get('connectVoice').onclick();assert.equal(c.micCalls,0);assert.equal(c.sessionCalls,0);
c=client({delayedMic:true});let pending=c.elements.get('connectVoice').onclick();await tick();c.elements.get('endVoice').onclick();c.releaseMic();await pending;assert.equal(c.track.stopped,true);assert.equal(c.sessionCalls,0);
c=client({delayedSession:true});pending=c.elements.get('connectVoice').onclick();await tick();assert.equal(c.sessionCalls,1);c.elements.get('endVoice').onclick();c.releaseSession();await pending;assert.equal(c.track.stopped,true);assert.equal(c.elements.get('connectVoice').disabled,false);
c=client();await c.elements.get('connectVoice').onclick();c.elements.get('muteVoice').onclick();assert.equal(c.track.enabled,false);c.elements.get('muteVoice').onclick();assert.equal(c.track.enabled,true);c.elements.get('stop').onclick();assert.equal(c.track.stopped,true);
c=client();await c.elements.get('connectVoice').onclick();c.handlers.pagehide();assert.equal(c.track.stopped,true);
console.log('PASS frontend readiness failure, late microphone cancellation, late session cancellation, connect, mute/unmute, Stop and page-exit cleanup; all API calls mocked');
