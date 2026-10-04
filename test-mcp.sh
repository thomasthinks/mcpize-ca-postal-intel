#!/bin/bash
# MCP Protocol Smoke Test for ca-postal-intel
# Usage: Start your server first, then run: bash test-mcp.sh
#   PORT=8080 node dist/index.js & sleep 2; bash test-mcp.sh

BASE_URL="${MCP_URL:-http://localhost:8080}"
MCP_ENDPOINT="$BASE_URL/mcp"
HEALTH_ENDPOINT="$BASE_URL/health"
PASSED=0
FAILED=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}FAIL${NC} $1: $2"; FAILED=$((FAILED + 1)); }

mcp_call() {
  local id="$1" method="$2" params="$3"
  curl -sf -X POST "$MCP_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"$method\",\"params\":$params}" 2>/dev/null || true
}

echo "Testing MCP server at $BASE_URL"
echo "================================"

# 1. Health check
echo ""
echo "--- Health Check ---"
HEALTH=$(curl -sf "$HEALTH_ENDPOINT" 2>/dev/null) || true
if echo "$HEALTH" | grep -q "healthy"; then
  pass "GET /health returns healthy"
else
  fail "GET /health" "Expected 'healthy' in response, got: $HEALTH"
fi

# 2. Initialize handshake
echo ""
echo "--- MCP Initialize ---"
INIT_RESPONSE=$(mcp_call 1 "initialize" '{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}')
if echo "$INIT_RESPONSE" | grep -q '"result"'; then
  pass "initialize returns result"
else
  fail "initialize" "No 'result' in response: $INIT_RESPONSE"
fi

# 3. List tools
echo ""
echo "--- List Tools ---"
TOOLS_RESPONSE=$(mcp_call 2 "tools/list" '{}')
if echo "$TOOLS_RESPONSE" | grep -q '"tools"'; then
  pass "tools/list returns tools array"
  TOOL_COUNT=$(echo "$TOOLS_RESPONSE" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['result']['tools']))" 2>/dev/null || echo "?")
  echo "     Found $TOOL_COUNT tool(s)"
else
  fail "tools/list" "No 'tools' in response: $TOOLS_RESPONSE"
fi

# 4. Check specific tools exist
echo ""
echo "--- Tool Registration ---"
EXPECTED_TOOLS=("lookup_postal_code" "validate_postal_code" "fsa_to_region")
for TOOL in "${EXPECTED_TOOLS[@]}"; do
  if echo "$TOOLS_RESPONSE" | grep -q "\"$TOOL\""; then
    pass "Tool '$TOOL' is registered"
  else
    fail "Tool '$TOOL'" "Not found in tools/list response"
  fi
done

# 5. Call each tool
echo ""
echo "--- Call lookup_postal_code (K1A 0B1) ---"
CALL_RESPONSE=$(mcp_call 3 "tools/call" '{"name":"lookup_postal_code","arguments":{"postal_code":"K1A 0B1"}}')
if echo "$CALL_RESPONSE" | grep -q '"content"' && echo "$CALL_RESPONSE" | grep -q '"K1A"'; then
  pass "lookup_postal_code returns content with FSA K1A"
else
  fail "lookup_postal_code" "Unexpected response: $CALL_RESPONSE"
fi

echo ""
echo "--- Call validate_postal_code (M5V 2T6) ---"
CALL_RESPONSE=$(mcp_call 4 "tools/call" '{"name":"validate_postal_code","arguments":{"postal_code":"M5V 2T6"}}')
if echo "$CALL_RESPONSE" | grep -q '"valid_format":true'; then
  pass "validate_postal_code returns valid_format=true"
else
  fail "validate_postal_code" "Unexpected response: $CALL_RESPONSE"
fi

echo ""
echo "--- Call validate_postal_code (XYZ, invalid) ---"
CALL_RESPONSE=$(mcp_call 5 "tools/call" '{"name":"validate_postal_code","arguments":{"postal_code":"XYZ"}}')
if echo "$CALL_RESPONSE" | grep -q '"valid_format":false'; then
  pass "validate_postal_code gracefully reports invalid format"
else
  fail "validate_postal_code invalid input" "Unexpected response: $CALL_RESPONSE"
fi

echo ""
echo "--- Call fsa_to_region (V6B) ---"
CALL_RESPONSE=$(mcp_call 6 "tools/call" '{"name":"fsa_to_region","arguments":{"fsa":"V6B"}}')
if echo "$CALL_RESPONSE" | grep -q '"content"' && echo "$CALL_RESPONSE" | grep -q '"BC"'; then
  pass "fsa_to_region resolves V6B to BC"
else
  fail "fsa_to_region" "Unexpected response: $CALL_RESPONSE"
fi

echo ""
echo "--- Call lookup_postal_code ('', bad input) ---"
CALL_RESPONSE=$(mcp_call 7 "tools/call" '{"name":"lookup_postal_code","arguments":{"postal_code":""}}')
if echo "$CALL_RESPONSE" | grep -q '"isError":true'; then
  pass "lookup_postal_code returns isError for empty input (no crash)"
else
  fail "lookup_postal_code bad input" "Expected isError=true, got: $CALL_RESPONSE"
fi

# 6. Ping
echo ""
echo "--- Ping ---"
PING_RESPONSE=$(mcp_call 8 "ping" '{}')
if echo "$PING_RESPONSE" | grep -q '"result"'; then
  pass "ping returns result"
else
  fail "ping" "No 'result' in response: $PING_RESPONSE"
fi

# Summary
echo ""
echo "================================"
echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"

if [ $FAILED -gt 0 ]; then
  exit 1
fi
