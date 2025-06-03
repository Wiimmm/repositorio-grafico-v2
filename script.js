const CLIENT_ID = '25371662123-opqktsrvje4ab91s0i9e4lt0bgvmo1g2.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
let accessToken;
let directoryHandle;
let currentNameBase = '';
let currentExt = '';
let lastVersion = null;

function handleAuth() {
    google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            accessToken = tokenResponse.access_token;
            document.getElementById("auth-button").style.display = "none";
            document.getElementById("fileperm").style.display = "block";
        }
    }).requestAccessToken();
}

async function perms() {
    try {
        directoryHandle = await window.showDirectoryPicker({
            startIn: 'documents',
            mode: 'readwrite'
        });

        if (directoryHandle.name !== "rg-files") {
            alert("Por favor, selecione a pasta 'rg-files'.");
            return;
        }

        document.getElementById("fileperm").style.display = "none";
        document.getElementById("infos").style.display = "block";

        let db = await getDatabase(directoryHandle);
        let nextId = db.files.length > 0 ? Math.max(...db.files.map(item => item.id)) + 1 : 1;

        function extractUniqueValues(fieldName) {
            const valuesSet = new Set();
            db.files.forEach(file => {
                let fieldValue = file[fieldName];
                if (!fieldValue) return;
                if (typeof fieldValue === 'string' && fieldValue.trim().startsWith('[')) {
                    try {
                        fieldValue = JSON.parse(fieldValue);
                    } catch {
                        fieldValue = [fieldValue];
                    }
                }
                if (!Array.isArray(fieldValue)) {
                    fieldValue = [fieldValue];
                }
                fieldValue.forEach(val => {
                    if (val) valuesSet.add(val);
                });
            });
            return [...valuesSet];
        }

        const projects = extractUniqueValues('project');
        const $projectSelect = $('#project-select');
        $projectSelect.empty();
        projects.forEach(project => $projectSelect.append(new Option(project, project)));
        $projectSelect.val(null).trigger('change');

        const clients = extractUniqueValues('client');
        const $clientSelect = $('#client-select');
        $clientSelect.empty();
        clients.forEach(client => $clientSelect.append(new Option(client, client)));
        $clientSelect.val(null).trigger('change');
    } catch (erro) {
        console.error("Erro ao selecionar a pasta:", erro);
    }
}

function initializeSelect2() {
    $('#file-type').select2();
    $('#file-lang').select2();
    $('#project-select').select2({ tags: true, placeholder: "Selecione ou adicione um projeto" });
    $('#client-select').select2({ tags: true, placeholder: "Selecione ou adicione um cliente" });
}

async function generatePreviewFromPDF(pdfUrl, numPages = 3) {
    const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
    const previews = [];
    for (let i = 1; i <= Math.min(numPages, pdf.numPages); i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;
        previews.push(canvas.toDataURL('image/jpeg', 0.5));
    }
    URL.revokeObjectURL(pdfUrl);
    return previews;
}

async function renderSvgToImage(svgUrl) {
    const img = new Image();
    img.src = svgUrl;
    await new Promise(resolve => img.onload = resolve);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const context = canvas.getContext('2d');
    context.drawImage(img, 0, 0);
    const imageUrl = canvas.toDataURL('image/jpeg');
    URL.revokeObjectURL(svgUrl); 
    return imageUrl;
}

async function uploadAndConvertToPDF(file, fileType) {
    if (!accessToken) {
        alert('Faça login no Google primeiro!');
        return;
    }

    let mimeType;
    if (fileType === 'pptx') {
        mimeType = 'application/vnd.google-apps.presentation';
    } else if (fileType === 'docx') {
        mimeType = 'application/vnd.google-apps.document';
    } else {
        throw new Error('Tipo de arquivo não suportado para conversão');
    }

    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify({
        name: file.name,
        mimeType
    })], { type: 'application/json' }));
    formData.append('file', file);

    try {
        const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&convert=true', {
            method: 'POST',
            headers: new Headers({ Authorization: 'Bearer ' + accessToken }),
            body: formData,
        });
        const uploadData = await uploadRes.json();
        const fileId = uploadData.id;
        document.getElementById('file').value = 50;

        const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`, {
            method: 'GET',
            headers: { Authorization: 'Bearer ' + accessToken },
        });

        document.getElementById('file').value = 100;

        const pdfBlob = await exportRes.blob();
        const pdfUrl = URL.createObjectURL(pdfBlob);
        return pdfUrl;
    } catch (error) {
        console.error('Erro ao enviar ou converter o arquivo:', error);
    }
}

async function mostrarVersoesAnteriores(nameBase, ext) {
    const db = await getDatabase(directoryHandle);
    const file = db.files.find(f => f.name === nameBase && f.type === ext);

    const versionList = document.getElementById('version-list');
    versionList.innerHTML = '<h2>Versões Anteriores</h2>';

    if (!file || !file.versions || file.versions.length === 0) {
        versionList.innerHTML += '<p>Nenhuma versão anterior encontrada.</p>';
        lastVersion = null;
        return;
    }

    file.versions.forEach(version => {
        const versionItem = document.createElement('div');
        versionItem.classList.add('version-item');

        const dateSpan = document.createElement('span');
        dateSpan.classList.add('version-date');
        dateSpan.textContent = version.importedDate;

        const actionsDiv = document.createElement('div');
        actionsDiv.classList.add('version-actions');

        const commentBtn = document.createElement('button');
        commentBtn.classList.add('comment-btn');
        commentBtn.innerHTML = 'Observações';
        commentBtn.setAttribute('title', version.obs || 'Sem observações');

        const downloadBtn = document.createElement('button');
        downloadBtn.classList.add('download-btn');
        downloadBtn.innerHTML = 'Download';
        downloadBtn.addEventListener('click', () => {
            window.location.href = version.filepath;
        });

        actionsDiv.appendChild(commentBtn);
        actionsDiv.appendChild(downloadBtn);

        versionItem.appendChild(dateSpan);
        versionItem.appendChild(actionsDiv);

        versionList.appendChild(versionItem);
    });

    lastVersion = file.versions[file.versions.length - 1];
}

async function renderSnap(previewPath) {
  const snapElement = document.getElementById('snap');
  if (!snapElement) {
    console.error('Elemento com id \"snap\" não encontrado');
    return;
  }

  try {
    const pathParts = previewPath.split('/');
    let currentDir = directoryHandle;

    for (let i = 0; i < pathParts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(pathParts[i], { create: false });
    }

    const fileHandle = await currentDir.getFileHandle(pathParts.at(-1), { create: false });
    const file = await fileHandle.getFile();
    const fileUrl = URL.createObjectURL(file);

    snapElement.src = fileUrl;
    snapElement.alt = 'First slide preview';
    snapElement.style.width = '350px';
  } catch (error) {
    console.error('Erro ao carregar o snap:', error);
    snapElement.src = '';
  }
}

initializeSelect2();

document.getElementById('inputfile').addEventListener('change', async function (event) {
    console.log('Evento change disparado, arquivo:', event.target.files[0]);
    initializeSelect2();
    const progressbar = document.getElementById('file');
    progressbar.value = 0;
    const previewContainer = document.getElementById('preview-container');
    previewContainer.innerHTML = '';
    document.getElementById('btnToggle').style.display = 'none';

    const file = event.target.files[0];
    if (!file) return;

    const namefile = file.name;
    const filenamesplited = namefile.split('.').slice(0, -1).join('.');
    const year = new Date(file.lastModified).getFullYear();
    document.getElementById('year').innerHTML = "Ano: " + year;
    document.getElementById('filename').innerHTML = "Nome: " + filenamesplited;

    const ext = file.name.split('.').pop().toLowerCase();
    currentExt = ext;
    currentNameBase = filenamesplited.replace(/_(\d{4}-\d{2}-\d{2})$/, '');

    if (ext === 'pdf') {
        const pdfUrl = URL.createObjectURL(file);
        const previews = await generatePreviewFromPDF(pdfUrl, 3);
        previews.forEach(src => {
            const img = document.createElement('img');
            img.src = src;
            document.getElementById('file').value = 100;
            previewContainer.appendChild(img);
        });
    } else if (['jpeg', 'jpg', 'png'].includes(ext)) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        document.getElementById('file').value = 100;
        previewContainer.appendChild(img);
    } else if (ext === 'svg') {
        const svgUrl = URL.createObjectURL(file);
        const imgSrc = await renderSvgToImage(svgUrl);
        const img = document.createElement('img');
        img.src = imgSrc;
        document.getElementById('file').value = 100;
        previewContainer.appendChild(img);
    } else if (ext === 'docx' || ext === 'pptx') {
        const pdfUrl = await uploadAndConvertToPDF(file, ext);
        if (pdfUrl) {
            const previews = await generatePreviewFromPDF(pdfUrl, 3);
            previews.forEach(src => {
                const img = document.createElement('img');
                img.src = src;
                document.getElementById('file').value = 100;
                previewContainer.appendChild(img);
            });
        }
    }

    let valor = ext === 'pdf' || ext === 'docx' ? 'Documento' : ['png', 'jpg', 'jpeg', 'svg'].includes(ext) ? 'Grafismo' : ext === 'pptx' ? 'Apresentação' : null;
    if (valor) $('#file-type').val(valor).trigger('change');

    if (directoryHandle) {
        const db = await getDatabase(directoryHandle);
        const nameBase = filenamesplited.replace(/_(\d{4}-\d{2}-\d{2})$/, '');
        const existingFile = db.files.find(f => f.name === nameBase && f.type === ext);

        console.log('nameBase:', nameBase, 'ext:', ext, 'db.files:', db.files);
        if (existingFile) {
            console.log('Arquivo encontrado:', existingFile);

            const projects = Array.isArray(existingFile.project) ? existingFile.project : [existingFile.project];
            $('#project-select').val(projects).trigger('change');
            $('#client-select').val(existingFile.client).trigger('change');

            const filegroup = existingFile.filegroup || '';
            const selectedGroup = $('#file-type').val() || '';

            document.getElementById('btnToggle').style.display = 'block';

            if (Array.isArray(existingFile.previewPaths) && existingFile.previewPaths.length > 0) {
                await renderSnap(existingFile.previewPaths[0]);
            }

            const vInfoName = document.getElementById('v-info-name');
            if (vInfoName) vInfoName.innerHTML = existingFile.name || '';

            const vInfoClient = document.getElementById('v-info-client');
            if (vInfoClient) vInfoClient.innerHTML = existingFile.client || '';

            const vInfoProject = document.getElementById('v-info-project');
            if (vInfoProject) vInfoProject.innerHTML = existingFile.project || '';

            const vInfoLang = document.getElementById('v-info-lang');
            if (vInfoLang) vInfoLang.innerHTML = existingFile.lang || '';

            const obs = existingFile.versions && existingFile.versions.length > 0 ? existingFile.versions[existingFile.versions.length - 1].obs : '';
            const vInfoObs = document.getElementById('v-info-obs');
            if (vInfoObs) vInfoObs.innerHTML = obs || '';

            const vInfoFilegroup = document.getElementById('v-info-filegroup');
            if (vInfoFilegroup) vInfoFilegroup.innerHTML = filegroup || '';

            const importeddate = existingFile.versions && existingFile.versions.length > 0 ? existingFile.versions[existingFile.versions.length - 1].importedDate : '';
            const vInfoImportedDate = document.getElementById('v-info-importeddate');
            if (vInfoImportedDate) vInfoImportedDate.innerHTML = importeddate || '';

            await mostrarVersoesAnteriores(nameBase, ext);
        }
        else {
            console.log('Arquivo não encontrado');
            $('#project-select').val(null).trigger('change');
            $('#client-select').val(null).trigger('change');
            const vInfoObs = document.getElementById('v-info-obs');
            if (vInfoObs) vInfoObs.innerHTML = '';

            const versionList = document.getElementById('version-list');
            versionList.innerHTML = '<h2>Versões Anteriores</h2><p>Nenhuma versão anterior encontrada.</p>';
        }
    }
});


document.getElementById('btnShare').addEventListener('click', () => {
    if (lastVersion && lastVersion.filepath) {
        navigator.clipboard.writeText(lastVersion.filepath)
            .then(() => alert('Link da partilha copiado para a área de transferência!'))
            .catch(err => console.error('Erro ao copiar o link:', err));
    } else {
        alert('Nenhuma versão anterior disponível para compartilhar.');
    }
});

document.getElementById('btnDownload').addEventListener('click', () => {
    if (lastVersion && lastVersion.filepath) {
        const link = document.createElement('a');
        link.href = lastVersion.filepath;
        link.download = lastVersion.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } else {
        alert('Nenhuma versão anterior disponível para download.');
    }
});

document.getElementById('upload-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const inputfile = document.getElementById('inputfile');
    const arquivos = inputfile.files;
    if (arquivos.length === 0) {
        alert('Nenhum arquivo selecionado!');
        return;
    }

    const projects = $('#project-select').val();
    const client = $('#client-select').val();

    if (!projects || projects.length === 0 || !client) {
        alert('Selecione ou adicione pelo menos um projeto e um cliente!');
        return;
    }

    try {
        let db = await getDatabase(directoryHandle);
        let nextId = db.files.length > 0 ? Math.max(...db.files.map(item => item.id)) + 1 : 1;
        const previewsFolder = await directoryHandle.getDirectoryHandle('previews', { create: true });

        for (const arquivo of arquivos) {
            const nome = arquivo.name;
            const tipo = nome.split('.').pop().toLowerCase();
            const validTypes = ['pptx', 'docx', 'pdf', 'jpg', 'jpeg', 'png', 'svg'];
            if (!validTypes.includes(tipo)) {
                alert(`Arquivo ${nome} não suportado!`);
                continue;
            }

            const nameBase = nome.replace(/_(\d{4}-\d{2}-\d{2})\.[^/.]+$/, '').replace(/\.[^/.]+$/, '');

            let existingFile = db.files.find(file => file.name === nameBase && file.type === tipo);
            let newVersionName;

            if (existingFile) {
                existingFile.project = projects;
                existingFile.client = client;

                const todayStr = new Date().toISOString().split('T')[0];
                const filegroup = $('#file-type').val();

                const versionIndex = existingFile.versions.findIndex(v =>
                    v.importedDate === todayStr && v.filegroup === filegroup
                );

                if (versionIndex >= 0) {
                    newVersionName = existingFile.versions[versionIndex].name;

                    const previewFolderName = `${newVersionName}-preview`;
                    try {
                        const previewFolder = await previewsFolder.getDirectoryHandle(previewFolderName);
                        for await (const handle of previewFolder.values()) {
                            await previewFolder.removeEntry(handle.name);
                        }
                    } catch (e) {
                    }

                    existingFile.versions.splice(versionIndex, 1);
                } else {
                    const today = new Date();
                    newVersionName = `${nameBase}_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.${tipo}`;
                }
            } else {
                const today = new Date();
                newVersionName = `${nameBase}_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.${tipo}`;

                const filegroup = $('#file-type').val();

                existingFile = {
                    id: nextId++,
                    name: nameBase,
                    project: projects,
                    client: client,
                    lang: $('#file-lang').val(),
                    type: tipo,
                    filegroup: filegroup,
                    versions: []
                };
                db.files.push(existingFile);
            }

            const importacao = new Date().toISOString().split('T')[0];
            const lastModified = new Date(arquivo.lastModified).toISOString().split('T')[0];
            let previewPaths = [];

            const extensionFolder = await directoryHandle.getDirectoryHandle(tipo, { create: true });
            const fileNameFolder = await extensionFolder.getDirectoryHandle(nameBase, { create: true });
            const fileHandle = await fileNameFolder.getFileHandle(newVersionName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(arquivo);
            await writable.close();

            const previewBaseFolder = await directoryHandle.getDirectoryHandle('previews', { create: true });
            const previewTypeFileFolder = await previewBaseFolder.getDirectoryHandle(tipo, { create: true });
            const previewVersionFolder = await previewTypeFileFolder.getDirectoryHandle(newVersionName, { create: true });

            if (['pdf', 'docx', 'pptx'].includes(tipo)) {
                let pdfUrl;
                if (tipo === 'pdf') {
                    pdfUrl = URL.createObjectURL(arquivo);
                } else {
                    pdfUrl = await uploadAndConvertToPDF(arquivo, tipo);
                }
                if (pdfUrl) {
                    const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
                    for (let i = 1; i <= pdf.numPages; i++) {
                        const page = await pdf.getPage(i);
                        const viewport = page.getViewport({ scale: 2 });
                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d');
                        canvas.width = viewport.width;
                        canvas.height = viewport.height;
                        await page.render({ canvasContext: context, viewport }).promise;
                        const slideBlob = await fetch(canvas.toDataURL('image/jpeg', 0.5)).then(res => res.blob());
                        const previewHandle = await previewVersionFolder.getFileHandle(`slide-${i}.jpeg`, { create: true });
                        const previewWritable = await previewHandle.createWritable();
                        await previewWritable.write(slideBlob);
                        await previewWritable.close();
                        console.log('Salvando preview:', `previews/${nameBase}/${tipo}/${newVersionName}/slide-${i}.jpeg`);
                        previewPaths.push(`previews/${tipo}/${newVersionName}/slide-${i}.jpeg`);

                    }
                }
            } else if (['jpeg', 'jpg', 'png', 'svg'].includes(tipo)) {
                let imgBlob;
                if (tipo === 'svg') {
                    const svgUrl = URL.createObjectURL(arquivo);
                    const imgSrc = await renderSvgToImage(svgUrl);
                    imgBlob = await fetch(imgSrc).then(res => res.blob());
                } else {
                    imgBlob = arquivo;
                }
                const previewHandle = await previewVersionFolder.getFileHandle('preview.jpg', { create: true });
                const previewWritable = await previewHandle.createWritable();
                await previewWritable.write(imgBlob);
                await previewWritable.close();
                console.log('Salvando preview:', `previews/${nameBase}/${tipo}/${newVersionName}/preview.jpg`);
                previewPaths.push(`previews/${tipo}/${newVersionName}/preview.jpg`);
            }

            existingFile.versions.push({
                name: newVersionName,
                obs: document.getElementById('textbox').value,
                lastModified: lastModified,
                importedDate: importacao,
                filepath: `rg-files/${tipo}/${nameBase}/${newVersionName}`,
            });

            if (previewPaths.length > 0) existingFile.previewPaths = previewPaths;

            document.getElementById('file').value = 100;
        }

        db.lastUpdate = formatDateTime(new Date());
        await saveDatabase(directoryHandle, db);
        console.log('JSON atualizado com sucesso!');
    } catch (err) {
        console.error('Erro ao processar os arquivos:', err);
        alert('Erro ao processar os arquivos!');
    }
});

function formatDateTime(date) {
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}h${pad(date.getMinutes())}m${pad(date.getSeconds())}s`;
}

async function getDatabase(directoryHandle) {
    try {
        const fileHandle = await directoryHandle.getFileHandle('imported-db.json', { create: true });
        const file = await fileHandle.getFile();
        const text = await file.text();
        return text ? JSON.parse(text) : { lastUpdate: formatDateTime(new Date()), files: [] };
    } catch (error) {
        console.error('Erro ao acessar imported-db.json:', error);
        return { lastUpdate: formatDateTime(new Date()), files: [] };
    }
}

async function saveDatabase(directoryHandle, db) {
    try {
        const fileHandle = await directoryHandle.getFileHandle('imported-db.json', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(db, null, 2));
        await writable.close();
    } catch (error) {
        console.error('Erro ao salvar imported-db.json:', error);
    }
}

document.getElementById('btnToggle').addEventListener('click', event => {
    document.getElementById('aboutDialog').toggleAttribute('open');
    document.getElementById('btnCloseDialog').focus();
});

document.getElementById('btnCloseDialog').addEventListener('click', event => {
    document.getElementById('aboutDialog').removeAttribute('open');
});