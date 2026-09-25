from pathlib import Path
ROOT=Path("openalgo")
tool_src=Path("openalgo_agent_sire_tool.py")
(ROOT/"services/agent/tools/sire.py").write_text(tool_src.read_text(),encoding="utf-8")

registry=ROOT/"services/agent/tools/__init__.py"
s=registry.read_text(encoding="utf-8")
s=s.replace('SURFACE_VOICE = "voice"','SURFACE_VOICE = "voice"\nSURFACE_SIRE = "sire"')
s=s.replace('ALL_SURFACES: frozenset[str] = frozenset({SURFACE_CHAT, SURFACE_CHART, SURFACE_VOICE})','ALL_SURFACES: frozenset[str] = frozenset({SURFACE_CHAT, SURFACE_CHART, SURFACE_VOICE})\nSIRE_ONLY: frozenset[str] = frozenset({SURFACE_SIRE})')
s=s.replace('"SURFACE_CHAT",\n    "TOOLKITS"', '"SURFACE_CHAT",\n    "SURFACE_SIRE",\n    "SIRE_ONLY",\n    "TOOLKITS"')
marker='TOOLKITS: list[ToolkitSpec] = ['
entry='''TOOLKITS: list[ToolkitSpec] = [
    ToolkitSpec(
        key="sire_runtime",
        module="services.agent.tools.sire",
        attr="SireToolkit",
        surfaces=SIRE_ONLY,
        order=1,
        description="SIRE chart, Deriv market data, deterministic analysis, replay/drawings and autonomous observer.",
    ),'''
if 'key="sire_runtime"' not in s:
    s=s.replace(marker,entry,1)
registry.write_text(s,encoding="utf-8")

bridge=ROOT/"blueprints/sire_agent_bridge.py"
bridge.write_text('''from __future__ import annotations
import os
from flask import Blueprint, request
from services.agent import builder
from services.agent.tools import ToolContext

sire_agent_bp=Blueprint("sire_agent_bp", __name__, url_prefix="/agent/api/sire")

def _auth():
    expected=os.environ.get("SIRE_AGENT_BRIDGE_TOKEN","").strip()
    supplied=request.headers.get("Authorization","").replace("Bearer ","",1).strip()
    return bool(expected and supplied and supplied==expected)

@sire_agent_bp.post("/run")
def run_sire_agent():
    if not _auth():
        return {"status":"error","message":"Unauthorized"},401
    body=request.get_json(silent=True) or {}
    message=str(body.get("message") or "").strip()
    if not message:
        return {"status":"error","message":"message is required"},400
    session_id=str(body.get("session_id") or "sire-default")
    user_id=str(body.get("user_id") or "sire")
    try:
        context=ToolContext(
            api_key="sire-internal",
            surface="sire",
            user_id=user_id,
            session_id=session_id,
            extras={"sire_chart_context":body.get("chart_context") or {}, "model_id":body.get("model_id")},
        )
        agent=builder.build_agent(context,session_id=session_id,reasoning_effort=body.get("reasoning_effort"))
        result=agent.run(message,stream=False)
        content=getattr(result,"content",None)
        if not isinstance(content,str): content=str(content or "")
        return {"status":"success","text":content,"session_id":session_id,"run_id":str(getattr(result,"run_id","") or "")}
    except builder.AgentBuildError as exc:
        return {"status":"error","message":exc.message,"kind":exc.kind},exc.status
    except Exception as exc:
        return {"status":"error","message":str(exc)},502
''',encoding="utf-8")


smoke=ROOT/"sire_agent_smoke.py"
smoke.write_text('''import json, os, threading, time, urllib.request
def run():
    time.sleep(12)
    base="http://127.0.0.1:5000"
    token=os.environ.get("SIRE_AGENT_BRIDGE_TOKEN","").strip()
    payload={"message":"Use the SIRE runtime market-data tool to fetch WLDAUD 1m candles with count 30. After the tool succeeds, reply with exactly SIRE_AGENT_SMOKE_OK.","session_id":"sire-live-smoke","user_id":"sire-smoke","chart_context":{"symbol":"WLDAUD","interval":"1m"}}
    try:
        req=urllib.request.Request(base+"/agent/api/sire/run",data=json.dumps(payload).encode(),method="POST",headers={"Accept":"application/json","Content-Type":"application/json","Authorization":"Bearer "+token})
        with urllib.request.urlopen(req,timeout=150) as res:
            raw=res.read().decode()
            data=json.loads(raw or "{}")
        if res.status==200 and data.get("status")=="success" and "SIRE_AGENT_SMOKE_OK" in str(data.get("text","")):
            print("[SIRE AGENT SMOKE PASSED] "+json.dumps({"runId":data.get("run_id",""),"sessionId":data.get("session_id","")}),flush=True)
        else:
            print("[SIRE AGENT SMOKE FAILED] "+json.dumps({"status":getattr(res,"status",None),"data":data}),flush=True)
    except Exception as exc:
        print("[SIRE AGENT SMOKE FAILED] "+json.dumps({"error":str(exc)}),flush=True)
threading.Thread(target=run,daemon=True).start()
''',encoding="utf-8")


seed=ROOT/"sire_agent_seed.py"
seed.write_text('''import os
from database import agent_db

def ensure():
    agent_db.init_db()
    base=os.environ.get("SIRE_BRIDGE_URL","").rstrip("/") + "/api/openai/v1"
    token=os.environ.get("SIRE_AGENT_BRIDGE_TOKEN","").strip()
    model=os.environ.get("SIRE_AGENT_MODEL","gemini-3.6-flash").strip()
    if not base or not token:
        return
    rows=agent_db.list_models()
    row=next((x for x in rows if x.get("provider_kind")=="openai_compatible" and x.get("model_name")==model and x.get("base_url")==base),None)
    if row is None:
        row,err=agent_db.create_model({"provider_kind":"openai_compatible","model_name":model,"display_name":"SIRE Gemini Free","base_url":base,"enabled":True,"supports_reasoning":False,"supports_vision":False,"tools_unreliable":False})
        if err: raise RuntimeError(err)
    model_id=int(row["id"])
    stored,err=agent_db.set_secret(agent_db.model_secret_name(model_id),token)
    if not stored: raise RuntimeError(err or "Could not store SIRE bridge token")
    ok,err=agent_db.record_model_test(model_id,True)
    if not ok: raise RuntimeError(err or "Could not mark SIRE model ready")
    print("[SIRE AGENT SEED] model ready "+model+" via "+base, flush=True)
ensure()
''',encoding="utf-8")

app=ROOT/"app.py"
s=app.read_text(encoding="utf-8")
if 'from blueprints.sire_agent_bridge import sire_agent_bp' not in s:
    s=s.replace('from blueprints.agent import agent_bp','from blueprints.agent import agent_bp\nfrom blueprints.sire_agent_bridge import sire_agent_bp')
if '    app.register_blueprint(sire_agent_bp)' not in s:
    s=s.replace('    app.register_blueprint(agent_bp)  # Register Agent blueprint','    app.register_blueprint(agent_bp)  # Register Agent blueprint\n    app.register_blueprint(sire_agent_bp)')
if '    import sire_agent_seed' not in s:
    s=s.replace('    app.register_blueprint(sire_agent_bp)','    app.register_blueprint(sire_agent_bp)\n    try:\n        import sire_agent_seed\n    except Exception as exc:\n        print(f"[SIRE AGENT SEED] {exc}")')
app.write_text(s,encoding="utf-8")
print("OpenAlgo SIRE bridge patched")
