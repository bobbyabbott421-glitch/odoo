from contextlib import closing
import pathlib,sys,subprocess,json
import requests,websocket
pid=sys.argv[1]
children=subprocess.check_output(['ps','--ppid',pid,'-o','pid=,comm='],text=True).splitlines()
child=next(x.split()[0] for x in children if x.split()[1]=='chromium')
args=pathlib.Path('/proc',child,'cmdline').read_bytes().decode().split('\0')
profile=next(a.split('=',1)[1] for a in args if a.startswith('--user-data-dir='))
port=(pathlib.Path(profile)/'DevToolsActivePort').read_text().splitlines()[0]
tabs=requests.get('http://127.0.0.1:'+port+'/json/list').json()
for t in tabs:
 if t['type']!='page': continue
 with closing(websocket.create_connection(t['webSocketDebuggerUrl'],suppress_origin=True,timeout=5)) as ws:
  ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':"JSON.stringify({url:location.href,ready:document.readyState,body:document.body?.innerText.slice(0,450),scripts:[...document.scripts].slice(-9).map(e=>e.src),errors:globalThis.odoo?.loader?.checkErrorProm||false})",'returnByValue':True}}))
  print(ws.recv()[:1250])
