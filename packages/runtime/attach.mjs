import { inspectNativeModule, nativeCaptureExpression } from './native-adapter.mjs';

export async function attachNativeModule(cdp) {
  if (await cdp.evaluate('!!globalThis.__stCompatibilityNative')) return { reused: true };
  await cdp.send('Debugger.enable');
  let breakpoint, paused;
  try {
    const fn = await cdp.send('Runtime.evaluate', { expression: 'globalThis.__debugV3Plugin' });
    if (!fn.result.objectId) throw new Error('客户端尚未提供插件运行接口');
    breakpoint = await cdp.send('Debugger.setBreakpointOnFunctionCall', { objectId: fn.result.objectId });
    const pausePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cdp.off('Debugger.paused', receive); reject(new Error('原生接口接入超时')); }, 10000);
      const receive = value => { clearTimeout(timer); resolve(value); };
      cdp.once('Debugger.paused', receive);
    });
    const trigger = cdp.send('Runtime.evaluate', {
      expression: "try{globalThis.__debugV3Plugin('void 0','__st_scope_probe__')}catch{}",
    });
    void trigger.catch(() => {});
    paused = await pausePromise;
    try {
      const frame = paused.callFrames[0];
      const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: frame.location.scriptId });
      const bindings = inspectNativeModule(scriptSource);
      const response = await cdp.send('Debugger.evaluateOnCallFrame', {
        callFrameId: frame.callFrameId, expression: nativeCaptureExpression(bindings), returnByValue: true,
      });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? '原生接线失败');
      return { bindings, ...response.result.value };
    } finally {
      await cdp.send('Debugger.resume'); paused = null;
      await trigger;
    }
  } finally {
    if (paused) await cdp.send('Debugger.resume').catch(() => {});
    if (breakpoint) await cdp.send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId }).catch(() => {});
    await cdp.send('Debugger.disable').catch(() => {});
  }
}
