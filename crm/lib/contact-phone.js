'use strict';
const FIRST_PHONE_ONLY = true;
function extrairNumerosDaCelula(bruto) {
  return String(bruto)
    .split(/[;,/]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Limpa e valida um número no formato internacional. Planilhas antigas sem
// as colunas País/DDI continuam assumindo Brasil (55). O buscador novo grava
// E.164 com "+", eliminando a ambiguidade entre números de países diferentes.
function limparNumero(bruto, ddiPadrao = '55') {
  const texto = String(bruto || '').trim();
  const digitos = texto.replace(/\D/g, '');
  const ddi = String(ddiPadrao || '55').replace(/\D/g, '');

  if (!digitos) {
    return { valido: false, numero: '', motivo: 'célula vazia' };
  }

  const internacionalExplicito = texto.startsWith('+') || texto.startsWith('00');
  if (internacionalExplicito) {
    const numeroInternacional = texto.startsWith('00') ? digitos.slice(2) : digitos;
    if (numeroInternacional.length >= 8 && numeroInternacional.length <= 15 && !numeroInternacional.startsWith('0')) {
      return { valido: true, numero: numeroInternacional };
    }
    return { valido: false, numero: numeroInternacional, motivo: 'formato E.164 internacional inválido' };
  }

  if (ddi === '55') {
    if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
      return { valido: true, numero: digitos };
    }
    if (digitos.length === 10 || digitos.length === 11) {
      return { valido: true, numero: `55${digitos}` };
    }
    return { valido: false, numero: digitos, motivo: 'formato brasileiro inesperado' };
  }

  if (ddi && digitos.startsWith(ddi) && digitos.length >= 8 && digitos.length <= 15) {
    return { valido: true, numero: digitos };
  }

  const comDdi = `${ddi}${digitos}`;
  if (ddi && comDdi.length >= 8 && comDdi.length <= 15) {
    return { valido: true, numero: comDdi };
  }
  return { valido: false, numero: digitos, motivo: 'formato internacional inesperado' };
}

// Estima se um valor de célula "parece" um telefone (bastante dígitos).
function pareceTelefone(valor) {
  const digitos = String(valor).replace(/\D/g, '');
  return digitos.length >= 8 && digitos.length <= 15;
}

// Quando nenhuma coluna se chama "numero" ou "telefone" (ex: cabeçalho
// veio em branco na planilha), tenta descobrir qual coluna tem telefone
// olhando o CONTEÚDO das células: a coluna onde a maioria dos valores
// parece número de telefone é escolhida. Retorna a chave da coluna ou
// null se nenhuma bater com confiança suficiente.
function detectarColunaTelefonePorConteudo(linhasNormalizadas) {
  const acertos = {};
  const total = {};

  for (const linha of linhasNormalizadas) {
    for (const [chave, valor] of Object.entries(linha)) {
      if (chave === 'nome' || !valor) continue;
      total[chave] = (total[chave] || 0) + 1;
      if (pareceTelefone(valor)) {
        acertos[chave] = (acertos[chave] || 0) + 1;
      }
    }
  }

  let melhorChave = null;
  let melhorRazao = 0;
  for (const chave of Object.keys(total)) {
    if (total[chave] < 5) continue; // amostra pequena demais pra confiar
    const razao = acertos[chave] / total[chave];
    if (razao >= 0.7 && razao > melhorRazao) {
      melhorRazao = razao;
      melhorChave = chave;
    }
  }
  return melhorChave;
}


module.exports={extrairNumerosDaCelula,limparNumero,detectarColunaTelefonePorConteudo,FIRST_PHONE_ONLY};
