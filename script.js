const CLIENT_ID = '25371662123-opqktsrvje4ab91s0i9e4lt0bgvmo1g2.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
let accessToken;
let directoryHandle;

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

document.getElementById('inputfile').addEventListener('change', async function (event) {
    initializeSelect2();
    const progressbar = document.getElementById('file');
    progressbar.value = 0;
    document.getElementById('preview-container').innerHTML = '';
    document.getElementById('btnToggle').style.display = 'none';

    const file = event.target.files[0];
    if (!file) return;

    const namefile = file.name;
    const filenamesplited = namefile.split('.').slice(0, -1).join('.');
    const year = new Date(file.lastModified).getFullYear();
    document.getElementById('year').innerHTML = "Ano: " + year;
    document.getElementById('filename').innerHTML = "Nome: " + filenamesplited;

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pptx') {
        uploadAndConvertToPDF(file);
    }

    let valor = ext === 'pdf' || ext === 'docx' ? 'Documento' : ['png', 'jpg', 'jpeg', 'svg'].includes(ext) ? 'Grafismo' : ext === 'pptx' ? 'Apresentação' : null;
    if (valor) $('#file-type').val(valor).trigger('change');

    if (directoryHandle) {
        const db = await getDatabase(directoryHandle);
        const nameBase = filenamesplited.replace(/_(\d{4}-\d{2}-\d{2})$/, '');
        const existingFile = db.files.find(f => f.name === nameBase);
        if (existingFile) {

            const filegroup = existingFile.versions && existingFile.versions.length > 0
                ? existingFile.versions[existingFile.versions.length - 1].filegroup
                : '';

            if ($('#file-type').val() === filegroup) {

                document.getElementById('btnToggle').style.display = 'block';

                const firstSlide = existingFile.previewPaths && existingFile.previewPaths.length > 0
                    ? existingFile.previewPaths[0]
                    : '';
                document.getElementById('snap').outerHTML = `<img src="rg-files/${firstSlide}" alt="First slide preview" style="width: 350px;">`;

                document.getElementById('v-info-name').innerHTML = existingFile.name;
                document.getElementById('v-info-client').innerHTML = existingFile.client;
                document.getElementById('v-info-project').innerHTML = existingFile.project;


                const obs = existingFile.versions && existingFile.versions.length > 0
                    ? existingFile.versions[existingFile.versions.length - 1].obs
                    : '';
                document.getElementById('v-info-obs').innerHTML = obs;

                document.getElementById('v-info-filegroup').innerHTML = filegroup;

                const importeddate = existingFile.versions && existingFile.versions.length > 0
                    ? existingFile.versions[existingFile.versions.length - 1].importedDate
                    : '';
                document.getElementById('v-info-importeddate').innerHTML = importeddate;

                const lang = existingFile.versions && existingFile.versions.length > 0
                    ? existingFile.versions[existingFile.versions.length - 1].lang
                    : '';
                document.getElementById('v-info-lang').innerHTML = lang;
            }

            const projects = Array.isArray(existingFile.project) ? existingFile.project : [existingFile.project];
            $('#project-select').val(projects).trigger('change');
            $('#client-select').val(existingFile.client).trigger('change');
            console.log(`Preenchendo projetos: ${projects.join(', ')}, cliente: ${existingFile.client}`);

        } else {
            $('#project-select').val(null).trigger('change');
            $('#client-select').val(null).trigger('change');
            document.getElementById('v-info-obs').innerHTML = '';

        }
    }

});


async function uploadAndConvertToPDF(file) {
    if (!accessToken) {
        alert('Faça login no Google primeiro!');
        return;
    }

    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify({
        name: file.name,
        mimeType: 'application/vnd.google-apps.presentation'
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
        const pdfBlob = await exportRes.blob();
        const pdfUrl = URL.createObjectURL(pdfBlob);
        generatePreviewFromPDF(pdfUrl);
    } catch (error) {
        console.error('Erro ao enviar ou converter o arquivo:', error);
    }
}

function generatePreviewFromPDF(pdfUrl) {
    pdfjsLib.getDocument(pdfUrl).promise.then(pdf => {
        document.getElementById('file').value = 100;
        const previewContainer = document.getElementById('preview-container');
        previewContainer.innerHTML = '';

        const slidesToPreview = Math.min(3, pdf.numPages);
        for (let i = 1; i <= slidesToPreview; i++) {
            pdf.getPage(i).then(page => {
                const viewport = page.getViewport({ scale: 2 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = viewport.width;
                canvas.height = viewport.height;

                page.render({ canvasContext: context, viewport }).promise.then(() => {
                    const img = document.createElement('img');
                    img.src = canvas.toDataURL('image/jpeg', 0.5);
                    img.alt = `Slide ${i}`;
                    previewContainer.appendChild(img);
                });
            });
        }
    }).catch(error => console.error('Erro ao processar o PDF:', error));
}

$(document).ready(function () {
    initializeSelect2();
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
            const validTypes = ['pptx', 'docx', 'pdf', 'jpg', 'jpeg', 'svg'];
            if (!validTypes.includes(tipo)) {
                alert(`Arquivo ${nome} não suportado!`);
                continue;
            }

            const nameBase = nome.replace(/_(\d{4}-\d{2}-\d{2})\.[^/.]+$/, '').replace(/\.[^/.]+$/, '');

            let existingFile = db.files.find(file => file.name === nameBase);
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

                existingFile = {
                    id: nextId++,
                    name: nameBase,
                    project: projects,
                    client: client,
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

            if (tipo === 'pptx' && accessToken) {
                // Upload e conversão para PDF e geração preview (igual antes)
                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify({ name: newVersionName, mimeType: 'application/vnd.google-apps.presentation' })], { type: 'application/json' }));
                form.append('file', arquivo);

                const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&convert=true', {
                    method: 'POST',
                    headers: new Headers({ Authorization: 'Bearer ' + accessToken }),
                    body: form,
                });
                const uploadData = await uploadRes.json();

                const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/export?mimeType=application/pdf`, {
                    method: 'GET',
                    headers: { Authorization: 'Bearer ' + accessToken },
                });
                const pdfBlob = await exportRes.blob();
                const pdfUrl = URL.createObjectURL(pdfBlob);
                const pdf = await pdfjsLib.getDocument(pdfUrl).promise;

                const previewBaseFolder = await previewsFolder.getDirectoryHandle(nameBase, { create: true });
                const previewTypeFileFolder = await previewBaseFolder.getDirectoryHandle(tipo, { create: true });
                const previewVersionFolder = await previewTypeFileFolder.getDirectoryHandle(newVersionName, { create: true });

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

                    previewPaths.push(`previews/${nameBase}/${tipo}/${newVersionName}/slide-${i}.jpeg`);
                }

                URL.revokeObjectURL(pdfUrl);
            }

            const filegroup = $('#file-type').val();

            existingFile.versions.push({
                name: newVersionName,
                type: tipo,
                filegroup: filegroup,
                obs: document.getElementById('textbox').value,
                lang: $('#file-lang').val(),
                lastModified: lastModified,
                importedDate: importacao,
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

btnToggle.addEventListener('click', event => {
    aboutDialog.toggleAttribute('open');
    btnCloseDialog.focus();
})

btnCloseDialog.addEventListener('click', event => {
    aboutDialog.removeAttribute('open');
})