//@name risu-st-compatibility
//@display-name 酒馆运行层
//@api 3.0
//@version 0.2.0
//@link https://github.com/GuraQwQ/RisuAI-ST-Compatibility 使用说明

(async () => {
    let serial = 0;
    const waiting = new Map();
    const command = (name, payload) => new Promise((resolve, reject) => {
        const requestId = ++serial;
        const packet = { channel: 'st-compatibility-plugin', requestId, command: name, payload };
        const retry = name === 'enable' ? setInterval(() => parent.postMessage(packet, '*'), 1000) : null;
        const timer = setTimeout(() => { waiting.delete(requestId); clearInterval(retry); reject(new Error('请安装运行层后重新启动 RisuAI.exe，再重试。')); }, 65000);
        waiting.set(requestId, { resolve, reject, timer, retry });
        parent.postMessage(packet, '*');
    });
    window.addEventListener('message', event => {
        if (event.source !== parent || event.data?.channel !== 'st-compatibility-plugin') return;
        const pending = waiting.get(event.data.requestId);
        if (!pending) return;
        waiting.delete(event.data.requestId); clearTimeout(pending.timer); clearInterval(pending.retry);
        event.data.error ? pending.reject(new Error(event.data.error)) : pending.resolve(event.data.result);
    });
    document.body.innerHTML = `<main style="max-width:760px;margin:auto;padding:24px;color:#eee;font:16px system-ui">
      <h1>酒馆运行层</h1>
      <p>选择角色卡，预览迁移内容后创建兼容角色。</p>
      <label>角色卡 <input id="file" type="file" accept=".json,.png,.charx"></label>
      <p><label>模型连接 <select id="provider"><option value="local">本地固定回复</option><option value="risu">Risu 当前主模型</option></select></label></p>
      <p id="local-reply"><label>固定回复 <textarea id="response" rows="3" style="display:block;width:100%;color:#eee;background:#222">本地固定回复。&lt;StatusPlaceHolderImpl/&gt;</textarea></label></p>
      <p><button id="configure">保存当前角色连接</button></p>
      <button id="preview">预览迁移</button> <button id="import" disabled>导入</button> <button id="status">查看运行记录</button> <button id="close">关闭</button>
      <pre id="result" style="white-space:pre-wrap;overflow-wrap:anywhere" role="status"></pre>
    </main>`;
    const result = document.getElementById('result');
    const connection = () => ({provider: document.getElementById('provider').value, localResponse: document.getElementById('response').value});
    const showConnection = () => { document.getElementById('local-reply').hidden = connection().provider !== 'local'; };
    document.getElementById('provider').onchange = showConnection;
    document.getElementById('configure').onclick = async () => {
        try { await command('configure', connection()); result.textContent = '当前角色连接已保存。'; }
        catch (error) { result.textContent = String(error); }
    };
    let source;
    document.getElementById('file').onchange = () => { source = null; document.getElementById('import').disabled = true; };
    document.getElementById('preview').onclick = async () => {
        try {
            const file = document.getElementById('file').files[0];
            if (!file) { result.textContent = '请先选择角色卡文件。'; return; }
            result.textContent = '正在读取角色卡…';
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = '';
            for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
            source = { base64: btoa(binary), filename: file.name };
            const report = await command('preview', source);
            result.textContent = `${report.name}\n格式：${report.format}\n世界书：${report.worldEntries} 条；正则：${report.regexScripts} 条；资源：${report.resources} 个\n\n脚本依赖：\n${report.scripts.map(script => `${script.name}：${script.urls.join('、') || '卡内脚本'}`).join('\n')}\n\n原始文件与全部字段将保留。`;
            document.getElementById('import').disabled = false;
        } catch (error) { result.textContent = String(error); }
    };
    document.getElementById('import').onclick = async () => {
        try {
            if (!source) return;
            result.textContent = '正在导入…';
            const response = await command('import', { ...source,
                ...connection() });
            result.textContent = response.reused ? '已打开现有兼容角色。' : '角色已导入。';
        } catch (error) { result.textContent = String(error); }
    };
    document.getElementById('status').onclick = async () => {
        try { result.textContent = JSON.stringify(await command('status'), null, 2); }
        catch (error) { result.textContent = String(error); }
    };
    document.getElementById('close').onclick = () => risuai.hideContainer();
    await risuai.registerSetting('酒馆运行层', async () => {
        risuai.showContainer('fullscreen');
        try {
            const current = await command('current');
            if (current) {
                document.getElementById('provider').value = current.provider;
                document.getElementById('response').value = current.localResponse;
                showConnection();
            }
        } catch (error) { result.textContent = String(error); }
    }, '', 'none', 'st-compatibility');
    void command('enable').catch(error => { result.textContent = String(error.message); });
})();
