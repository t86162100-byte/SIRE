from __future__ import annotations
import json, os, urllib.request
from services.agent.tools.base import OpenAlgoToolkit

class SireToolkit(OpenAlgoToolkit):
    """Bridge OpenAlgo Agent reasoning into SIRE's real chart and Deriv runtime."""
    def __init__(self, context):
        self.context = context
        super().__init__(name="sire_runtime", tools=[
            self.get_chart_context,
            self.get_market_data,
            self.analyze_chart,
            self.control_chart,
            self.get_observer_status,
        ])

    def _call(self, path, payload=None):
        base=os.environ.get("SIRE_BRIDGE_URL","").rstrip("/")
        token=os.environ.get("SIRE_AGENT_BRIDGE_TOKEN","")
        if not base or not token:
            raise RuntimeError("SIRE bridge is not configured")
        body=dict(payload or {})
        body.setdefault("session_id", getattr(self.context,"session_id",None))
        body.setdefault("user_id", getattr(self.context,"user_id",None))
        data=json.dumps(body).encode()
        req=urllib.request.Request(
            base+path, data=data,
            method="POST" if payload is not None else "GET",
            headers={"Accept":"application/json","Content-Type":"application/json","Authorization":"Bearer "+token},
        )
        with urllib.request.urlopen(req,timeout=35) as res:
            return res.read().decode()

    def get_chart_context(self) -> str:
        """Read the current SIRE chart context supplied for this agent session."""
        value=self.context.extras.get("sire_chart_context") if hasattr(self.context,"extras") else None
        return json.dumps(value or {}, separators=(",",":"))

    def get_market_data(self, symbol: str, interval: str="1m", count: int=200) -> str:
        """Fetch actual Deriv OHLC candles through SIRE. Never invent market data."""
        return self._call("/api/sire/agent/market-data", {"symbol":symbol,"interval":interval,"count":max(30,min(1000,int(count)))})

    def analyze_chart(self, symbol: str="", interval: str="1m", count: int=200) -> str:
        """Run SIRE deterministic analysis on actual OHLC candles."""
        return self._call("/api/sire/agent/analyze", {"symbol":symbol,"interval":interval,"count":max(30,min(1000,int(count)))})

    def control_chart(self, operations: list[dict]) -> str:
        """Execute and verify chart operations in the user's active SIRE chart."""
        return self._call("/api/sire/agent/chart-control", {"operations":operations[:10]})

    def get_observer_status(self) -> str:
        """Read the autonomous SIRE market observer state and recent events."""
        return self._call("/api/sire/agent/observer-status")
