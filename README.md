# Crachá | US Vale Verde

Aplicação estática para localizar um colaborador pelo registro e gerar a frente e o verso do crachá em PDF ou PNG de alta resolução.

## Dados

- Planilha Google: `1R4h8YtBFPDzD70DlNZQ88C7nJ9Gd9Yfd`
- Abas consultadas: `Matriz` (colaboradores e permissões) e `Treinamentos` (cadastro de treinamentos)
- A planilha precisa permitir leitura para qualquer pessoa com o link. A página lê as abas pelo endpoint de visualização do Google ao abrir e no botão de atualizar.
- As fotos são correspondidas pelo número de registro com os arquivos da pasta `Fotos dos Funcionários` no Drive.
- O app não grava dados na planilha. Fotos adicionadas pelo operador ficam no armazenamento local do navegador neste computador.

## Publicação

O workflow `.github/workflows/pages.yml` publica a raiz do repositório no GitHub Pages a cada envio para `main`.

## Operação

1. Informe o número de registro e selecione **Buscar**.
2. Se necessário, associe a foto do colaborador pelo botão **Foto**.
3. Baixe o PDF (frente e verso) ou os dois PNGs em alta resolução.
