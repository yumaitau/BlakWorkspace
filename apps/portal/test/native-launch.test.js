'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');

test('Forms native launch binds the browser device before OAuth',async()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../services/workspace-shell/launch.js'),'utf8');
  for(const existing of [null,'existing-device']) {
    const values=new Map(existing?[['HEYFORM_DEVICE_ID',JSON.stringify(existing)]]:[]);
    let destination;
    const document={cookie:'',getElementById:()=>{throw Error('Launch failed');}};
    await vm.runInNewContext(source,{
      URL,crypto,document,
      localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},
      location:{origin:'https://forms.example.test',replace:url=>{destination=url;}},
      fetch:async()=>({json:async()=>[{id:'forms',url:'https://forms.example.test/'}]}),
    });
    const device=JSON.parse(values.get('HEYFORM_DEVICE_ID'));
    assert.equal(new URL(destination,'https://forms.example.test').searchParams.get('state'),device);
    assert(document.cookie.startsWith('HEYFORM_DEVICE_ID='+encodeURIComponent(device)+';'));
    if(existing) assert.equal(device,existing);
  }
});
