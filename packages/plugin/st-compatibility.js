//@name risu-st-compatibility
//@display-name 酒馆运行层
//@api 3.0
//@version 0.3.0
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
    document.body.innerHTML = `<style>
      :root { color-scheme:dark; background:#11131a; color:#eee; font:16px/1.55 system-ui; }
      * { box-sizing:border-box; }
      html,body { margin:0; min-height:100%; background:#11131a; }
      body { min-height:100vh; padding:0; }
      main { max-width:920px; margin:auto; padding:24px; }
      h1 { margin:0 0 12px; font-size:26px; }
      button,input,select,textarea { font:inherit; color:inherit; accent-color:#8bb6ed; }
      button,select,input[type=search],textarea { background:#222735; border:1px solid #596171; border-radius:5px; padding:7px 10px; }
      button { cursor:pointer; margin:3px 4px 3px 0; }
      button:hover { background:#30394b; }
      button:disabled { opacity:.5; cursor:default; }
      input[type=file] { width:min(100%,460px); }
      select { max-width:100%; }
      textarea { width:100%; resize:vertical; }
      input:focus-visible,button:focus-visible,select:focus-visible,textarea:focus-visible { outline:2px solid #8bb6ed; outline-offset:2px; }
      #preset-select { width:100%; margin-top:6px; }
      #prompt-list label,#worldbook-list label { overflow-wrap:anywhere; padding:3px 0; }
      fieldset { min-width:0; }
      @media(max-width:600px) { main { padding:16px; } fieldset { padding:12px!important; } }
    </style><main>
      <h1>酒馆运行层</h1>
      <p>选择角色卡，预览迁移内容后创建兼容角色。</p>
      <label>角色卡 <input id="file" type="file" accept=".json,.png,.charx"></label>
      <p><label>模型连接 <select id="provider"><option value="local">本地固定回复</option><option value="risu">Risu 当前主模型</option></select></label></p>
      <p id="local-reply"><label>固定回复 <textarea id="response" rows="3" style="display:block;width:100%;color:#eee;background:#222">本地固定回复。&lt;StatusPlaceHolderImpl/&gt;</textarea></label></p>
      <p><button id="configure">保存当前角色连接</button></p>
      <button id="preview">预览迁移</button> <button id="import" disabled>导入</button> <button id="status">查看运行记录</button> <button id="close">关闭</button>
      <fieldset style="margin-top:24px;border:1px solid #666;padding:16px">
        <legend>预设与世界书</legend>
        <p id="asset-target"></p>
        <p><label>ST 预设文件 <input id="preset-file" type="file" accept=".json"></label> <button id="import-preset">导入预设</button></p>
        <p><label>当前预设 <select id="preset-select"><option value="">默认</option></select></label></p>
        <p><label>编排组合 <select id="preset-order"></select></label>
          <label>宏引擎 <select id="macro-engine"><option value="legacy">ST 默认</option><option value="modern">ST 实验宏引擎</option></select></label></p>
        <label>搜索预设条目 <input id="prompt-search" type="search" placeholder="按名称搜索" style="max-width:100%"></label>
        <div id="prompt-list" style="max-height:35vh;overflow:auto;margin:12px 0" aria-label="预设开关"></div>
        <p><label>世界书文件 <input id="worldbook-file" type="file" accept=".json"></label> <button id="import-worldbook">导入世界书</button></p>
        <div id="worldbook-list" aria-label="附加世界书"></div>
        <p><button id="save-assets">保存预设与世界书</button></p>
        <p id="asset-result" role="status" style="overflow-wrap:anywhere"></p>
      </fieldset>
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
    const assetResult = document.getElementById('asset-result');
    const presetSelect = document.getElementById('preset-select');
    const presetOrder = document.getElementById('preset-order');
    const worldbookList = document.getElementById('worldbook-list');
    const promptList = document.getElementById('prompt-list');
    const checkedBooks = () => [...worldbookList.querySelectorAll('input:checked')].map(input => input.value);
    const option = (value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };
    const filterPrompts = () => {
        const text = document.getElementById('prompt-search').value.toLowerCase();
        for (const label of promptList.children) label.style.display = label.textContent.toLowerCase().includes(text) ? 'block' : 'none';
    };
    const renderAssets = state => {
        document.getElementById('asset-target').textContent = state.characterName ? `当前角色：${state.characterName}` : '选择兼容角色后，可应用预设与世界书。';
        presetSelect.replaceChildren(option('', '默认'), ...state.library.filter(item => item.kind === 'preset').map(item => option(item.hash, item.name)));
        presetSelect.value = state.presetHash;
        presetOrder.replaceChildren(...state.orders.map(id => option(id, id === 100001 ? '单人聊天（100001）' : id === 100000 ? '全局组合（100000）' : String(id))));
        presetOrder.value = String(state.orderId ?? '');
        document.getElementById('macro-engine').value = state.macroEngine;
        promptList.replaceChildren(...state.prompts.map(prompt => {
            const label = document.createElement('label'); label.style.display = 'block';
            const input = document.createElement('input'); input.type = 'checkbox'; input.checked = prompt.enabled; input.dataset.identifier = prompt.identifier;
            label.append(input, document.createTextNode(` ${prompt.name}${prompt.role ? ' · ' + prompt.role : ''}`)); return label;
        }));
        worldbookList.replaceChildren(...state.library.filter(item => item.kind === 'worldbook').map(item => {
            const label = document.createElement('label'); label.style.display = 'block';
            const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.hash; input.checked = state.worldbookHashes.includes(item.hash);
            label.append(input, document.createTextNode(` ${item.name}（${item.report.entries} 条）`)); return label;
        }));
        filterPrompts();
    };
    const loadAssetView = async orderId => {
        const books = checkedBooks();
        const state = await command('assets', { presetHash: presetSelect.value, orderId });
        state.worldbookHashes = books; renderAssets(state);
    };
    presetSelect.onchange = () => { void loadAssetView().catch(error => { assetResult.textContent = String(error); }); };
    presetOrder.onchange = () => { void loadAssetView(presetOrder.value).catch(error => { assetResult.textContent = String(error); }); };
    document.getElementById('prompt-search').oninput = filterPrompts;
    for (const kind of ['preset', 'worldbook']) document.getElementById(`import-${kind}`).onclick = async () => {
        try {
            const file = document.getElementById(`${kind}-file`).files[0];
            if (!file) { assetResult.textContent = '请先选择文件。'; return; }
            assetResult.textContent = '正在导入…';
            const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
            for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
            const response = await command('importAsset', { kind, filename: file.name, base64: btoa(binary) });
            renderAssets(response.settings); assetResult.textContent = response.reused ? '已复用现有资源。' : response.applied ? '资源已导入，已为当前兼容角色选用。' : '资源已添加到资源库。';
        } catch (error) { assetResult.textContent = String(error); }
    };
    document.getElementById('save-assets').onclick = async () => {
        try {
            const toggles = Object.fromEntries([...promptList.querySelectorAll('input')].map(input => [input.dataset.identifier, input.checked]));
            const state = await command('assetSettings', { presetHash: presetSelect.value, orderId: presetOrder.value, toggles,
                macroEngine: document.getElementById('macro-engine').value, worldbookHashes: checkedBooks() });
            renderAssets(state); assetResult.textContent = '已保存到当前兼容角色。';
        } catch (error) { assetResult.textContent = String(error); }
    };
    await risuai.registerSetting('酒馆运行层', async () => {
        risuai.showContainer('fullscreen');
        try {
            const current = await command('current');
            if (current) {
                document.getElementById('provider').value = current.provider;
                document.getElementById('response').value = current.localResponse;
                showConnection();
            }
            renderAssets(await command('assets'));
        } catch (error) { result.textContent = String(error); }
    }, '', 'none', 'st-compatibility');
    void command('enable').catch(error => { result.textContent = String(error.message); });
})();
