# Crachá | US Vale Verde

Aplicação estática para localizar um colaborador pelo nome ou registro e gerar a frente e o verso do crachá em PDF ou em PNGs de alta resolução compactados em ZIP.

## Dados

- Planilha Google: `1R4h8YtBFPDzD70DlNZQ88C7nJ9Gd9Yfd`
- Fotos dos colaboradores: [pasta no Google Drive](https://drive.google.com/drive/folders/1a1jEChDi6Vg1K6PEHqm6UqeDTEDCz4WB)
- Abas consultadas: `Matriz` (colaboradores, documentos e permissões) e `Treinamentos` (cadastro de treinamentos)
- A planilha precisa permitir leitura para qualquer pessoa com o link. A página lê as abas pelo endpoint de visualização do Google ao abrir e no botão de atualizar.
- As fotos são vinculadas ao número de registro; os registros 6257 e 8260 usam as imagens da referência visual e os demais usam a pasta de fotos no Drive.
- O app não grava dados na planilha. Fotos adicionadas pelo operador ficam no armazenamento local do navegador neste computador.

## Publicação

O workflow `.github/workflows/pages.yml` publica a raiz do repositório no GitHub Pages a cada envio para `main`.

## Operação

1. Ao abrir, o site exibe automaticamente a CHI de um colaborador aleatório. Digite um nome ou registro para localizar outra pessoa.
2. Use **Ver planilha** para consultar as abas `Matriz` e `Treinamentos` dentro do site. Pesquise globalmente ou filtre valores por coluna. Passe o mouse ou foque **ATENÇÃO**/**VENCIDO** para ver a distância em dias até o vencimento ou o tempo vencido.
3. Se necessário, associe uma foto pelo botão **Foto**.
4. Em **Baixar PDF**, pesquise por nome ou registro, marque um ou mais colaboradores e gere folhas A4 paisagem com até quatro CHIs por página. Cada par frente/verso mantém tamanho de 54 × 81 mm, com intervalos para recorte; folhas incompletas ficam centralizadas. Ou baixe um ZIP com os dois PNGs em alta resolução da pessoa aberta.
