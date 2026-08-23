import { useState, type ChangeEvent } from 'react';
import { parseArquivo } from './formatador/parsers';
import { buscarTemplate, TEMPLATE_PADRAO_ID } from './formatador/templates';
import type { Documento } from './formatador/tipos';
import { baixarMarkdown } from './formatador/exportarMarkdown';
import { baixarDocx } from './formatador/exportarDocx';
import { baixarPdf } from './formatador/exportarPdf';
import { baixarEpub } from './formatador/exportarEpub';

export type FormatoSaida = 'md' | 'docx' | 'pdf' | 'epub';

function mensagemErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nomeArquivoSaida(titulo: string, formato: FormatoSaida): string {
  const base = (titulo || 'document').trim().replace(/[\\/:*?"<>|]+/g, '-');
  return `${base}.${formato}`;
}

/**
 * Estado + ações da aba Settings > Format: upload → parse (pdf/md/docx) pro
 * modelo intermediário `Documento` → escolha de template → download em
 * md/docx/pdf/epub. Todo o parsing/geração pesado fica em ./formatador/*,
 * carregado sob demanda (import dinâmico) — aqui é só orquestração de estado.
 */
export function useFormatador() {
  const [nomeOriginal, setNomeOriginal] = useState<string | null>(null);
  const [documento, setDocumento] = useState<Documento | null>(null);
  const [templateId, setTemplateId] = useState(TEMPLATE_PADRAO_ID);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [baixandoFormato, setBaixandoFormato] = useState<FormatoSaida | null>(null);

  async function handleArquivoSelecionado(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;

    setProcessando(true);
    setErro(null);
    setDocumento(null);
    try {
      const doc = await parseArquivo(arquivo);
      setNomeOriginal(arquivo.name);
      setDocumento(doc);
    } catch (err) {
      setErro(mensagemErro(err));
    } finally {
      setProcessando(false);
    }
  }

  function limpar() {
    setNomeOriginal(null);
    setDocumento(null);
    setErro(null);
  }

  async function baixar(formato: FormatoSaida) {
    if (!documento) return;
    setBaixandoFormato(formato);
    setErro(null);
    try {
      const template = buscarTemplate(templateId);
      const nomeArquivo = nomeArquivoSaida(documento.titulo, formato);
      if (formato === 'md') baixarMarkdown(documento, nomeArquivo);
      else if (formato === 'docx') await baixarDocx(documento, template, nomeArquivo);
      else if (formato === 'pdf') await baixarPdf(documento, template, nomeArquivo);
      else await baixarEpub(documento, template, nomeArquivo);
    } catch (err) {
      setErro(`Failed to generate ${formato.toUpperCase()}: ${mensagemErro(err)}`);
    } finally {
      setBaixandoFormato(null);
    }
  }

  return {
    nomeOriginal,
    documento,
    templateId,
    setTemplateId,
    processando,
    erro,
    baixandoFormato,
    handleArquivoSelecionado,
    limpar,
    baixar,
  };
}
