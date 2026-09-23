import { verifyConfiguredConnectors, discoverConnectors } from './agent-tools.ts';

function safeConnectorSummary(value: any) {
  const github = value?.github || {};
  const render = value?.render || {};
  return {
    github: {
      configured: Boolean(process.env.GITHUB_TOKEN),
      ok: Boolean(github.ok),
      login: github.login || null,
      error: github.ok ? null : (github.error || null),
    },
    render: {
      configured: Boolean(process.env.RENDER_API_KEY),
      ok: Boolean(render.ok),
      workspaceCount: Number(render.workspaceCount || 0),
      workspaces: Array.isArray(render.workspaces) ? render.workspaces.map((w: any) => ({ id: w.id, name: w.name })) : [],
      error: render.ok ? null : (render.error || null),
    },
  };
}

export async function runSireDiagnostics() {
  const startedAt = Date.now();
  const connectors = discoverConnectors();
  const verification = await verifyConfiguredConnectors();
  const chatRoute = '/api/sire/agent/council/stream';
  const directAgentRoute = '/api/sire/agent/openalgo';
  const autonomousRoute = '/api/sire/autonomous';

  const findings = [
    {
      id: 'CHAT_ROUTE',
      severity: 'info',
      status: 'confirmed',
      title: 'Chat UI execution path',
      detail: 'The SIRE chat UI sends normal messages to the AI council streaming endpoint, not the autonomous gateway endpoint.',
      evidence: chatRoute,
    },
    {
      id: 'AUTONOMOUS_NOT_CHAT',
      severity: 'warning',
      status: 'confirmed',
      title: 'Autonomous gateway is a separate path',
      detail: 'The GitHub/Render verification fix in the autonomous gateway cannot change normal council-chat answers unless the council imports or receives that verification evidence.',
      evidence: autonomousRoute,
    },
    {
      id: 'CONNECTORS',
      severity: 'info',
      status: verification.github?.ok && verification.render?.ok ? 'passed' : 'failed',
      title: 'Configured connector verification',
      detail: 'SIRE server-side GitHub and Render connectors were checked without exposing credentials.',
      evidence: safeConnectorSummary(verification),
    },
  ];

  return {
    ok: findings.every(item => item.status !== 'failed'),
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    service: 'SIRE diagnostics',
    findings,
    routes: { chatRoute, directAgentRoute, autonomousRoute },
    connectors: safeConnectorSummary(verification),
    nextCheck: 'Inspect backend/ai-team.ts: its final Gemini/GPT response is the user-facing council answer. Connector verification must be passed into that shared council context.',
    noSecrets: true,
  };
}
