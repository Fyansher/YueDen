/* Shared provider outcomes; caller cancellation remains an exception. */
const labels={'disabled':'未启用','skipped':'未执行','loading':'查询中','success':'成功','empty':'0 条结果','timeout':'请求超时','http-error':'HTTP 错误','parse-error':'解析错误','rate-limited':'被限流','upstream-failure':'上游故障'};
function classify(error){return error.name==='TimeoutError'?'timeout':error.name==='SyntaxError'?'parse-error':error.status===429?'rate-limited':error.status>=500?'upstream-failure':error.status?'http-error':'upstream-failure';}
function http(status){return Object.assign(Error('HTTP '+status),{status});}
async function run(id,work,parent,timeoutMs=15000){const signal=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(parent?[parent]:[])]);try{signal.throwIfAborted();const items=await work(signal);signal.throwIfAborted();return {id,state:items.length?'success':'empty',items,message:items.length?'找到 '+items.length+' 条结果':labels.empty};}catch(error){parent?.throwIfAborted();const state=classify(signal.aborted?signal.reason:error);return {id,state,items:[],message:labels[state]+(error.status?'（'+error.status+'）':''),status:error.status};}}
module.exports={labels,classify,http,run};
