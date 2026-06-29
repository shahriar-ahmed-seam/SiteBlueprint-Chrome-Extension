/**
 * @file freeze-shim.js
 * @description Generates the "freeze shim" — a self-contained script embedded
 * into every frozen HTML page so that AJAX-driven widgets (DataTables, charts,
 * etc.) keep showing the data that was captured at crawl time instead of
 * re-fetching from a server that no longer exists offline.
 *
 * Strategy: intercept jQuery/$ the instant they are assigned to the global
 * scope, patch `$.ajax`, and strip `ajax`/`serverSide` options from DataTables
 * constructors so frozen DOM rows are preserved. XHR and fetch are also stubbed
 * for same-origin/relative requests, returning an empty DataTables-shaped JSON
 * payload.
 *
 * NOTE: the generated code uses string concatenation (not template literals)
 * because backticks inside the returned source would break tooling that wraps
 * it; keeping it as a plain string also guarantees byte-for-byte stability.
 */

/**
 * @returns {string} the freeze shim source to inline into frozen pages.
 */
export function generateFreezeShimInlineCode() {
  return (
    '/* SiteBlueprint Freeze Shim v2 -- auto-injected, do not edit */\n' +
    '(function(){\n' +
    '"use strict";\n' +
    'if(window.__BP_SHIM_ACTIVE__)return;\n' +
    'window.__BP_SHIM_ACTIVE__=true;\n' +
    '\n' +
    '/* 0. Suppress DataTables alert popups */\n' +
    'var _na=window.alert;\n' +
    'window.alert=function(m){if(typeof m==="string"&&m.indexOf("DataTables")!==-1){console.warn("[BP-Shim] suppressed:",m);return;}_na.apply(this,arguments);};\n' +
    '\n' +
    '/* 1. isLocal helper */\n' +
    'function isLocal(url){\n' +
    '  if(!url||url==="")return true;\n' +
    '  try{var a=new URL(url,window.location.href);return a.origin===window.location.origin||a.protocol==="file:";}catch(e){return!(/^https?:\\/\\//.test(url));}\n' +
    '}\n' +
    '\n' +
    '/* 2. XHR stub -- handles addEventListener("load",...) used by modern jQuery */\n' +
    'var _NXHR=window.XMLHttpRequest;\n' +
    'window.XMLHttpRequest=function(){\n' +
    '  var real=new _NXHR(),_f=false,_ev={},_self=this;\n' +
    '  _self.open=function(m,url){_f=isLocal(url);if(!_f)real.open.apply(real,arguments);};\n' +
    '  _self.send=function(){\n' +
    '    if(!_f){real.send.apply(real,arguments);return;}\n' +
    '    _self.status=200;_self.statusText="OK";_self.readyState=4;\n' +
    '    var d=\'{"draw":1,"recordsTotal":0,"recordsFiltered":0,"data":[]}\';\n' +
    '    _self.responseText=d;_self.response=d;\n' +
    '    setTimeout(function(){\n' +
    '      (_ev.readystatechange||[]).forEach(function(fn){try{fn();}catch(e){}});\n' +
    '      (_ev.load||[]).forEach(function(fn){try{fn({});}catch(e){}});\n' +
    '      if(typeof _self.onreadystatechange==="function")try{_self.onreadystatechange();}catch(e){}\n' +
    '      if(typeof _self.onload==="function")try{_self.onload({});}catch(e){}\n' +
    '    },0);\n' +
    '  };\n' +
    '  _self.addEventListener=function(evt,fn){if(_f){(_ev[evt]=_ev[evt]||[]).push(fn);}else real.addEventListener.apply(real,arguments);};\n' +
    '  _self.removeEventListener=function(evt,fn){if(!_f)real.removeEventListener.apply(real,arguments);};\n' +
    '  _self.setRequestHeader=function(k,v){if(!_f)real.setRequestHeader(k,v);};\n' +
    '  _self.getResponseHeader=function(k){if(_f)return(k||"").toLowerCase()==="content-type"?"application/json":null;return real.getResponseHeader(k);};\n' +
    '  _self.getAllResponseHeaders=function(){if(_f)return"content-type: application/json\\r\\n";return real.getAllResponseHeaders();};\n' +
    '  _self.abort=function(){if(!_f)real.abort();};\n' +
    '  _self.overrideMimeType=function(m){if(!_f)try{real.overrideMimeType(m);}catch(e){}};\n' +
    '  ["timeout","withCredentials","responseType","upload"].forEach(function(p){\n' +
    '    Object.defineProperty(_self,p,{get:function(){try{return real[p];}catch(e){return null;}},set:function(v){try{real[p]=v;}catch(e){}},configurable:true});\n' +
    '  });\n' +
    '};\n' +
    '\n' +
    '/* 3. fetch() stub */\n' +
    'var _nf=window.fetch;\n' +
    'window.fetch=function(input,init){\n' +
    '  var url=typeof input==="string"?input:((input&&input.url)||"");\n' +
    '  if(isLocal(url)){\n' +
    '    var b=\'{"draw":1,"recordsTotal":0,"recordsFiltered":0,"data":[]}\';\n' +
    '    return Promise.resolve(new Response(b,{status:200,headers:{"Content-Type":"application/json"}}));\n' +
    '  }\n' +
    '  return _nf.apply(this,arguments);\n' +
    '};\n' +
    '\n' +
    '/* 4. jQuery / DataTables patches */\n' +
    '/* KEY: patch $.ajax the instant jQuery loads via property interceptor */\n' +
    'function applyDT($){\n' +
    '  if(!$||!$.fn)return;\n' +
    '  if($.fn.dataTable&&$.fn.dataTable.ext){$.fn.dataTable.ext.errMode="none";}\n' +
    '  function strip(cfg){if(!cfg||typeof cfg!=="object")return cfg;var c=Object.assign({},cfg);delete c.ajax;delete c.serverSide;return c;}\n' +
    '  ["DataTable","dataTable"].forEach(function(n){\n' +
    '    var orig=$.fn[n];\n' +
    '    if(orig&&!orig.__bp__){$.fn[n]=function(cfg){return orig.call(this,strip(cfg));};$.fn[n].__bp__=true;Object.assign($.fn[n],orig);}\n' +
    '  });\n' +
    '}\n' +
    'function patchJQ($){\n' +
    '  if(!$||!$.fn||$.__bp_done__)return;\n' +
    '  $.__bp_done__=true;\n' +
    '  /* a) patch $.ajax immediately so all AJAX calls are intercepted */\n' +
    '  if($.ajax){\n' +
    '    var _oa=$.ajax;\n' +
    '    $.ajax=function(u,o){\n' +
    '      var cfg=typeof u==="object"?u:Object.assign({url:u},o||{});\n' +
    '      if(isLocal((cfg&&cfg.url)||"")){\n' +
    '        var e={draw:1,recordsTotal:0,recordsFiltered:0,data:[]};\n' +
    '        var dfd=$.Deferred?$.Deferred():null;\n' +
    '        setTimeout(function(){if(cfg&&typeof cfg.success==="function")try{cfg.success(e,"success",null);}catch(ex){}if(dfd)dfd.resolveWith(null,[e,"success",null]);},0);\n' +
    '        if(dfd)return dfd.promise();\n' +
    '        return{done:function(){return this;},fail:function(){return this;},always:function(){return this;}};\n' +
    '      }\n' +
    '      return _oa.apply(this,arguments);\n' +
    '    };\n' +
    '  }\n' +
    '  /* b) add ready callback at FRONT of queue -- runs before page init scripts */\n' +
    '  $(document).ready(function(){\n' +
    '    applyDT($);\n' +
    '    if($.fn.dataTable&&$.fn.dataTable.ext)$.fn.dataTable.ext.errMode="none";\n' +
    '  });\n' +
    '  applyDT($);\n' +
    '}\n' +
    'function interceptJQ(name){\n' +
    '  var _v;\n' +
    '  try{\n' +
    '    Object.defineProperty(window,name,{\n' +
    '      configurable:true,enumerable:true,\n' +
    '      get:function(){return _v;},\n' +
    '      set:function(v){_v=v;if(v&&v.fn)try{patchJQ(v);}catch(e){}}\n' +
    '    });\n' +
    '  }catch(e){}\n' +
    '}\n' +
    '/* Patch immediately if already present */\n' +
    'if(window.jQuery&&window.jQuery.fn)patchJQ(window.jQuery);\n' +
    'if(window.$&&window.$.fn&&window.$!==window.jQuery)patchJQ(window.$);\n' +
    '/* Intercept future assignments */\n' +
    'interceptJQ("jQuery");interceptJQ("$");\n' +
    '/* Fallback poll in case defineProperty was overridden */\n' +
    'var _ft=setInterval(function(){var jq=window.jQuery||window.$;if(jq&&jq.fn&&!jq.__bp_done__)patchJQ(jq);},30);\n' +
    'setTimeout(function(){clearInterval(_ft);},15000);\n' +
    '\n' +
    'console.log("[SiteBlueprint] Freeze shim v2 active -- sync jQuery intercept.");\n' +
    '})();\n'
  );
}
