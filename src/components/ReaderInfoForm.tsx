import { useEffect, useState } from 'react';
import { temOverride, valorInfo } from '../lib/reader';
import { salvarInfoReader } from '../lib/salvarInfoReader';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { useListasPorCategoria } from '../hooks/useListas';
import { useToast } from './Toast';
import { TagPicker } from './TagPicker';
import type { CampoInfoReader, Obra, ReaderObra } from '../types';
import type { NovaReaderObra } from '../db/repo';

interface Props {
  reader: ReaderObra;
  obra: Obra | undefined;
}

const ROTULOS: Record<CampoInfoReader, string> = {
  titulo: 'Title',
  autor: 'Author',
  score: 'Rating',
  status: 'Status',
  generos: 'Genre',
  tags: 'Tags',
  link: 'Link',
  sinopse: 'Synopsis',
};

/**
 * Página de informações do documento. Cada campo mostra o valor efetivo — o
 * override do Reader quando existe, senão o que está no cadastro da obra — e
 * traz um checkbox "also save to the work".
 *
 * Marcado, o campo grava nos dois lugares (e o espelhamento manga<->novel que
 * já existe no repo acontece de graça). Desmarcado, fica só aqui: é o caso de
 * querer um título diferente no EPUB sem mexer no cadastro.
 */
export function ReaderInfoForm({ reader, obra }: Props) {
  const generosDisponiveis = useListasPorCategoria('genero');
  const tagsDisponiveis = useListasPorCategoria('tag');
  const { mostrarToast } = useToast();

  const [rascunho, setRascunho] = useState(() => montarRascunho(reader, obra));
  const [espelhar, setEspelhar] = useState<Partial<Record<CampoInfoReader, boolean>>>(reader.espelhar ?? {});

  // Recarrega quando o preview troca de obra (o modal é reaproveitado).
  useEffect(() => {
    setRascunho(montarRascunho(reader, obra));
    setEspelhar(reader.espelhar ?? {});
  }, [reader, obra]);

  const salvar = useAsyncAction(async () => {
    const changes: Partial<NovaReaderObra> = {
      info_titulo: vazioParaNull(rascunho.titulo),
      info_autor: vazioParaNull(rascunho.autor),
      info_score: rascunho.score.trim() ? Number(rascunho.score) : null,
      info_status: vazioParaNull(rascunho.status),
      info_link: vazioParaNull(rascunho.link),
      info_sinopse: vazioParaNull(rascunho.sinopse),
      info_generos: rascunho.generos.length > 0 ? rascunho.generos : null,
      info_tags: rascunho.tags.length > 0 ? rascunho.tags : null,
    };
    await salvarInfoReader(reader, obra, changes, espelhar);
    mostrarToast('Information saved');
  });

  function marcador(campo: CampoInfoReader) {
    return (
      <label className="reader-espelho">
        <input
          type="checkbox"
          checked={espelhar[campo] ?? false}
          onChange={(e) => setEspelhar((atual) => ({ ...atual, [campo]: e.target.checked }))}
        />
        also save to the work
      </label>
    );
  }

  function dica(campo: CampoInfoReader) {
    if (temOverride(reader, campo)) return null;
    return <span className="reader-herdado">inherited from the work</span>;
  }

  return (
    <div className="reader-info-form">
      <label className="reader-info-campo">
        <span className="reader-rotulo">
          {ROTULOS.titulo} {dica('titulo')}
        </span>
        <input value={rascunho.titulo} onChange={(e) => setRascunho({ ...rascunho, titulo: e.target.value })} />
        {marcador('titulo')}
      </label>

      <label className="reader-info-campo">
        <span className="reader-rotulo">
          {ROTULOS.autor} {dica('autor')}
        </span>
        <input value={rascunho.autor} onChange={(e) => setRascunho({ ...rascunho, autor: e.target.value })} />
        {marcador('autor')}
      </label>

      <label className="reader-info-campo">
        <span className="reader-rotulo">
          {ROTULOS.score} {dica('score')}
        </span>
        <input
          type="number"
          min={1}
          max={5}
          value={rascunho.score}
          onChange={(e) => setRascunho({ ...rascunho, score: e.target.value })}
        />
        {marcador('score')}
      </label>

      <label className="reader-info-campo">
        <span className="reader-rotulo">
          {ROTULOS.status} {dica('status')}
        </span>
        <input value={rascunho.status} onChange={(e) => setRascunho({ ...rascunho, status: e.target.value })} />
        {marcador('status')}
      </label>

      <div className="reader-info-campo">
        <TagPicker
          label={ROTULOS.generos}
          value={rascunho.generos}
          options={generosDisponiveis}
          onChange={(generos) => setRascunho({ ...rascunho, generos })}
        />
        {marcador('generos')}
      </div>

      <div className="reader-info-campo">
        <TagPicker
          label={ROTULOS.tags}
          value={rascunho.tags}
          options={tagsDisponiveis}
          onChange={(tags) => setRascunho({ ...rascunho, tags })}
        />
        {marcador('tags')}
      </div>

      <label className="reader-info-campo">
        <span className="reader-rotulo">
          {ROTULOS.link} {dica('link')}
        </span>
        <input value={rascunho.link} onChange={(e) => setRascunho({ ...rascunho, link: e.target.value })} />
        {marcador('link')}
      </label>

      <label className="reader-info-campo reader-info-campo-largo">
        <span className="reader-rotulo">
          {ROTULOS.sinopse} {dica('sinopse')}
        </span>
        <textarea
          rows={6}
          value={rascunho.sinopse}
          onChange={(e) => setRascunho({ ...rascunho, sinopse: e.target.value })}
        />
        {marcador('sinopse')}
      </label>

      <div className="reader-info-acoes">
        <button type="button" onClick={() => void salvar.executar()} disabled={salvar.executando}>
          {salvar.executando ? 'Saving…' : 'Save information'}
        </button>
        {salvar.erro && <span className="reader-erro">{salvar.erro}</span>}
      </div>
      <p className="reader-dica">
        Empty fields fall back to the work’s own record. Editing the work in Ratsnest does not overwrite what you
        type here.
      </p>
    </div>
  );
}

interface Rascunho {
  titulo: string;
  autor: string;
  score: string;
  status: string;
  link: string;
  sinopse: string;
  generos: string[];
  tags: string[];
}

function montarRascunho(reader: ReaderObra, obra: Obra | undefined): Rascunho {
  return {
    titulo: texto(valorInfo(reader, obra, 'titulo')),
    autor: texto(valorInfo(reader, obra, 'autor')),
    score: texto(valorInfo(reader, obra, 'score')),
    status: texto(valorInfo(reader, obra, 'status')),
    link: texto(valorInfo(reader, obra, 'link')),
    sinopse: texto(valorInfo(reader, obra, 'sinopse')),
    generos: lista(valorInfo(reader, obra, 'generos')),
    tags: lista(valorInfo(reader, obra, 'tags')),
  };
}

function texto(valor: unknown): string {
  return valor === null || valor === undefined ? '' : String(valor);
}

function lista(valor: unknown): string[] {
  return Array.isArray(valor) ? (valor as string[]) : [];
}

function vazioParaNull(valor: string): string | null {
  return valor.trim() ? valor.trim() : null;
}
