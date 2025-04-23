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

document.getElementById('upload-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const inputfile = document.getElementById('inputfile');
    const arquivos = inputfile.files;

    if (arquivos.length === 0) {
        alert('Nenhum arquivo selecionado!');
        return;
    }

    if (!accessToken) {
        alert('Faz o login com Google primeiro!');
        return;
    }

    try {
        const directoryHandle = await window.showDirectoryPicker({
            startIn: 'documents',
            mode: 'readwrite'
        });

        let db = await getDatabase(directoryHandle);
        let nextId = db.files.length > 0 ? Math.max(...db.files.map(item => item.id)) + 1 : 1;

        // directoryHandle já é rg-files, então acessamos previews diretamente
        const previewsFolder = await directoryHandle.getDirectoryHandle('previews', { create: true });

        for (const arquivo of arquivos) {
            if (arquivo.type !== 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
                alert(`Arquivo ${arquivo.name} não é um PowerPoint (.pptx)!`);
                continue;
            }

            const nome = arquivo.name;
            const tipo = nome.split('.').pop().toLowerCase();
            const ultimaEdicao = new Date(arquivo.lastModified).toISOString().split('T')[0];
            const importacao = new Date().toISOString().split('T')[0];
            const nomeSemExtensao = nome.replace(/\.[^/.]+$/, "");

            // Upload para Google Drive
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

            // Exportar como PDF
            const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${uploadData.id}/export?mimeType=application/pdf`, {
                method: 'GET',
                headers: { Authorization: 'Bearer ' + accessToken },
            });
            const pdfBlob = await exportRes.blob();
            const pdfUrl = URL.createObjectURL(pdfBlob);
            const pdf = await pdfjsLib.getDocument(pdfUrl).promise;

            // Criar pasta local por extensão e nome do arquivo (rg-files/tipodefile/nomedofile)
            const extensionFolder = await directoryHandle.getDirectoryHandle(tipo, { create: true });
            const fileNameFolder = await extensionFolder.getDirectoryHandle(nomeSemExtensao, { create: true });

            // Criar pasta de preview (rg-files/previews/pastacomonomedofile)
            const previewFolder = await previewsFolder.getDirectoryHandle(`${nomeSemExtensao}-preview`, { create: true });

            // Salvar arquivo original
            const fileHandle = await fileNameFolder.getFileHandle(nome, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(arquivo);
            await writable.close();

            // Extrair e salvar slides como PNG
            const zip = new JSZip();
            const slidePaths = [];
            const previewPaths = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 2 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = viewport.width;
                canvas.height = viewport.height;

                await page.render({ canvasContext: context, viewport }).promise;

                const dataUrl = canvas.toDataURL('image/png');
                const base64 = dataUrl.split(',')[1];
                zip.file(`slide-${i}.png`, base64, { base64: true });

                const slideBlob = await fetch(dataUrl).then(res => res.blob());

                // Salvar PNG na pasta de preview (rg-files/previews/pastacomonomedofile)
                const previewHandle = await previewFolder.getFileHandle(`slide-${i}.png`, { create: true });
                const previewWritable = await previewHandle.createWritable();
                await previewWritable.write(slideBlob);
                await previewWritable.close();
                previewPaths.push(`previews/${nomeSemExtensao}-preview/slide-${i}.png`);
            }

            // Atualizar banco de dados
            db.files.push({
                id: nextId++,
                name: nome,
                type: tipo,
                lastModified: ultimaEdicao,
                importatedDate: importacao,
                previewPaths: previewPaths
            });

            URL.revokeObjectURL(pdfUrl);
            alert(`Arquivo ${nome} processado e salvo com sucesso!`);
        }

        // Atualizar e salvar JSON
        db.lastUpdate = formatDateTime(new Date());
        await saveDatabase(directoryHandle, db);
        console.log('JSON atualizado com sucesso!');
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