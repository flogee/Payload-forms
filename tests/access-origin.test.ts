import test from 'node:test'
import assert from 'node:assert/strict'
import { accessMutationAllowed } from '../src/auth/request-origin'
test('Access cookie mutations require same origin; only MCP bearer requests permit a missing browser origin',()=>{
  const url='https://forms.example.invalid/api/users'
  assert.equal(accessMutationAllowed(new Request(url)),true)
  for(const method of ['POST','PATCH','PUT','DELETE']){
    assert.equal(accessMutationAllowed(new Request(url,{method,headers:{Origin:'https://forms.example.invalid'}})),true)
    assert.equal(accessMutationAllowed(new Request(url,{method})),false)
    assert.equal(accessMutationAllowed(new Request(url,{method,headers:{Origin:'https://evil.example.invalid'}})),false)
    assert.equal(accessMutationAllowed(new Request(url,{method,headers:{Authorization:'Bearer forged'}})),false)
  }
  assert.equal(accessMutationAllowed(new Request('https://forms.example.invalid/api/mcp',{method:'POST',headers:{Authorization:'Bearer fixture-key'}})),true)
  assert.equal(accessMutationAllowed(new Request('https://forms.example.invalid/api/mcp',{method:'POST',headers:{Authorization:'Bearer fixture-key',Origin:'https://evil.example.invalid'}})),false)
})
