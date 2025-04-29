const CLIENT_ID = '25371662123-opqktsrvje4ab91s0i9e4lt0bgvmo1g2.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';
let accessToken;

function handleAuth() {
    google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            accessToken = tokenResponse.access_token;
            alert('Login feito com sucesso!');
        }
    }).requestAccessToken();
}

function initializeSelect2() {
    $('#file-type').select2();
    $('#project-select').select2({
        tags: true,
        placeholder: "Selecione ou adicione um projeto",
        allowClear: true
    });
}

document.getElementById('inputfile').addEventListener('change', function(event) {
    initializeSelect2();

    let valor = null;
    const file = event.target.files[0];
    if (!file){
        console.log("No file selected");
        return;
    }

    const namefile = file.name;
    document.getElementById('filename').innerHTML = "Nome: " + namefile;
    
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf' || ext === 'docx') {
        valor = 'DOC';
    } else if (['png', 'jpg', 'jpeg', 'svg'].includes(ext)) {
        valor = 'DS';
    } else if (ext === 'pptx') {
        valor = 'PPT';
    }

    if (valor) {
        $('#file-type').val(valor).trigger('change');
    } else {
        console.log("No valid file type selected");
    }
});

$(document).ready(function() {
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

    const project = $('#project-select').val();
    if (!project) {
        alert('Selecione ou adicione um projeto!');
        return;
    }

    try {
        const directoryHandle = await window.showDirectoryPicker({
            startIn: 'documents',
            mode: 'readwrite'
        });

        let db = await getDatabase(directoryHandle);
        let nextId = db.files.length > 0 ? Math.max(...db.files.map(item => item.id)) + 1 : 1;

        const previewsFolder = await directoryHandle.getDirectoryHandle('previews', { create: true });

        for (const arquivo of arquivos) {
            const nome = arquivo.name;
            const tipo = nome.split('.').pop().toLowerCase();
            const validTypes = ['pptx', 'docx', 'pdf', 'jpg', 'jpeg', 'svg'];
            
            if (!validTypes.includes(tipo)) {
                alert(`Arquivo ${nome} não é um tipo suportado (.pptx, .docx, .pdf, .jpg, .jpeg, .svg)!`);
                continue;
            }

            const ultimaEdicao = new Date(arquivo.lastModified).toISOString().split('T')[0];
            const importacao = new Date().toISOString().split('T')[0];
            const nomeSemExtensao = nome.replace(/\.[^/.]+$/, "");
            let previewPaths = [];

            const extensionFolder = await directoryHandle.getDirectoryHandle(tipo, { create: true });
            const fileNameFolder = await extensionFolder.getDirectoryHandle(nomeSemExtensao, { create: true });

            const fileHandle = await fileNameFolder.getFileHandle(nome, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(arquivo);
            await writable.close();

            if (tipo === 'pptx') {
                if (!accessToken) {
                    alert('Faz o login com Google primeiro para processar arquivos .pptx!');
                    continue;
                }

                const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${nome}' and trashed=false and mimeType='application/vnd.google-apps.presentation'&fields=files(id,name)`, {
                    headers: { Authorization: 'Bearer ' + accessToken },
                });
                const searchData = await searchRes.json();
                const existingFile = searchData.files[0];

                const metadata = {
                    name: nome,
                    mimeType: 'application/vnd.google-apps.presentation',
                };
                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                form.append('file', arquivo);

                let uploadData;
                if (existingFile) {
                    const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`, {
                        method: 'PATCH',
                        headers: new Headers({ Authorization: 'Bearer ' + accessToken }),
                        body: form,
                    });
                    uploadData = await uploadRes.json();
                } else {
                    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&convert=true', {
                        method: 'POST',
                        headers: new Headers({ Authorization: 'Bearer ' + accessToken }),
                        body: form,
                    });
                    uploadData = await uploadRes.json();
                }

                const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/export?mimeType=application/pdf`, {
                    method: 'GET',
                    headers: { Authorization: 'Bearer ' + accessToken },
                });
                const pdfBlob = await exportRes.blob();
                const pdfUrl = URL.createObjectURL(pdfBlob);
                const pdf = await pdfjsLib.getDocument(pdfUrl).promise;

                const previewFolder = await previewsFolder.getDirectoryHandle(`${nomeSemExtensao}-preview`, { create: true });

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale: 2 });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;

                    await page.render({ canvasContext: context, viewport }).promise;

                    const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
                    const slideBlob = await fetch(dataUrl).then(res => res.blob());
                    const previewHandle = await previewFolder.getFileHandle(`slide-${i}.jpeg`, { create: true });
                    const previewWritable = await previewHandle.createWritable();
                    await previewWritable.write(slideBlob);
                    await previewWritable.close();
                    previewPaths.push(`previews/${nomeSemExtensao}-preview/slide-${i}.jpeg`);
                }

                URL.revokeObjectURL(pdfUrl);
            }

            db.files.push({
                id: nextId++,
                name: nome,
                type: tipo,
                project: project,
                lastModified: ultimaEdicao,
                importedDate: importacao,
                previewPaths: previewPaths
            });

            alert(`Arquivo ${nome} processado e salvo com sucesso!`);
        }

        db.lastUpdate = formatDateTime(new Date());
        await saveDatabase(directoryHandle, db);
        console.log('JSON atualizado com sucesso!');

        const projects = [...new Set(db.files.map(file => file.project).filter(project => project))];
        const $projectSelect = $('#project-select');
        $projectSelect.empty();
        projects.forEach(project => {
            const option = new Option(project, project, false, false);
            $projectSelect.append(option);
        });
        $projectSelect.val(null).trigger('change');
    } catch (err) {
        console.error('Erro ao processar os arquivos:', err);
        alert('Ocorreu um erro ao processar os arquivos!');
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
