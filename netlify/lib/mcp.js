/* Gameweek Edge — the MCP wire protocol, on its own.

   MCP is JSON-RPC 2.0. A remote, read-only, stateless server needs five
   methods of it — initialize, notifications/initialized, ping, tools/list
   and tools/call — and nothing else. That is small enough to write down,
   and writing it down is the reason this file exists rather than a
   dependency.

   WHY NOT THE OFFICIAL SDK. Its HTTP transport wants a Node request and
   response pair, or an Express app. A Netlify function is handed an `event`
   object and returns a plain `{statusCode, headers, body}`, so the SDK
   would need an adapter of about this size before it did anything. Against
   that: this repository declares every dependency it uses and checks it
   (scripts/check-deps.mjs), ships the app with no build step, and would be
   taking on a protocol library to serve six read-only tools. If this server
   ever grows sessions, streaming, resources or prompts, take the SDK and
   delete this file — those are the parts worth not writing yourself.

   Everything here is pure: tools in, a JSON-RPC response out. It does not
   know what a fixture is. dev/test-mcp.mjs holds it to the protocol. */

/* Versions this server knows how to speak, newest first. The handshake rule
   is the spec's: echo the client's version when it is one of these, and
   otherwise answer with our newest and let the client decide whether it can
   live with that. Answering with a version we do not implement would be
   worse than a version mismatch the client can see. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];

/* JSON-RPC 2.0 §5.1. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message, data) => ({
  jsonrpc: '2.0', id: id === undefined ? null : id,
  error: data === undefined ? { code, message } : { code, message, data },
});

/* A tool that throws reports through the RESULT, not through a JSON-RPC
   error: the distinction the spec draws is that a protocol error means the
   call never happened, while a tool that ran and failed is a result the
   model should get to see and act on. Hiding a "no player by that name"
   behind a transport error tells the model nothing it can use. */
function toolFailure(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/* Tool results carry the same payload twice on purpose: `structuredContent`
   for a client that can read the schema, and a text block for one that
   cannot. A client is free to ignore either. */
function toolResult(structured, text) {
  return {
    content: [{ type: 'text', text: text == null ? JSON.stringify(structured, null, 2) : text }],
    structuredContent: structured,
  };
}

/**
 * Answer one JSON-RPC message.
 *
 * @param {Object} msg    the parsed request
 * @param {Object} server {name, title, version, instructions}
 * @param {Object[]} tools  [{name, title, description, inputSchema, outputSchema,
 *                            annotations, run(args) -> structured}]
 * @returns {Promise<Object|null>}  the response, or null for a notification
 */
async function handleMessage(msg, server, tools) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
    return rpcError(msg && msg.id, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request');
  }
  const { method, id, params } = msg;
  if (typeof method !== 'string') return rpcError(id, INVALID_REQUEST, 'No method');

  /* A notification has no id and takes no response, ever — answering one is
     a protocol violation rather than a harmless extra. */
  const isNotification = id === undefined || id === null;

  if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null;

  if (method === 'initialize') {
    const asked = params && params.protocolVersion;
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST_PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: server.name, title: server.title, version: server.version },
      instructions: server.instructions,
    });
  }

  if (method === 'ping') return rpcResult(id, {});

  if (method === 'tools/list') {
    return rpcResult(id, {
      tools: tools.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        annotations: t.annotations,
      })),
    });
  }

  if (method === 'tools/call') {
    const name = params && params.name;
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return rpcError(id, INVALID_PARAMS, `No tool named ${JSON.stringify(name)}`,
        { available: tools.map((t) => t.name) });
    }
    try {
      const out = await tool.run((params && params.arguments) || {});
      return rpcResult(id, out && out.isError ? out : toolResult(out));
    } catch (err) {
      /* The message reaches a model, so it has to say what to do next, not
         just that something went wrong. */
      return rpcResult(id, toolFailure(String((err && err.message) || err)));
    }
  }

  if (isNotification) return null;
  return rpcError(id, METHOD_NOT_FOUND, `Unknown method ${JSON.stringify(method)}`);
}

/** Parse, dispatch, and handle a batch. Returns {status, body} for the caller. */
async function handleBody(raw, server, tools) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) {
    return { status: 400, body: rpcError(null, PARSE_ERROR, 'Invalid JSON') };
  }

  if (Array.isArray(parsed)) {
    if (!parsed.length) return { status: 400, body: rpcError(null, INVALID_REQUEST, 'Empty batch') };
    const out = [];
    for (const one of parsed) {
      const res = await handleMessage(one, server, tools);
      if (res) out.push(res);
    }
    /* A batch of nothing but notifications gets no body at all. */
    return out.length ? { status: 200, body: out } : { status: 202, body: null };
  }

  const res = await handleMessage(parsed, server, tools);
  return res ? { status: 200, body: res } : { status: 202, body: null };
}

module.exports = {
  PROTOCOL_VERSIONS, LATEST_PROTOCOL,
  PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR,
  handleMessage, handleBody, toolResult, toolFailure,
};
