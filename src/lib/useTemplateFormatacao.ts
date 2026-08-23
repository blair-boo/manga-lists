import { useEffect, useState, type ChangeEvent } from 'react';
import { TEMPLATES, buscarTemplate } from './formatador/templates';
import { parseTemplateDocx } from './formatador/parseTemplateDocx';
import {
  carregarTemplateCustomizadoSalvo,
  carregarTemplatePadrao,
  limparTemplateCustomizadoSalvo,
  salvarTemplateCustomizado,
} from './formatador/templateCustomizado';
import type { Template } from './formatador/tipos';

function mensagemErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Template ativo da aba Format: um template "Custom" (derivado de um .docx —
 * de início o ebook_template.docx embutido, depois qualquer arquivo que a
 * usuária suba pra substituí-lo, ficando salvo pro próximo acesso) + os 3
 * presets fixos como alternativa rápida. Separado de useFormatador porque é
 * um pedaço de estado independente (não depende do documento sendo formatado).
 */
export function useTemplateFormatacao() {
  const [customTemplate, setCustomTemplate] = useState<Template | null>(() => carregarTemplateCustomizadoSalvo());
  const [selecionadoId, setSelecionadoId] = useState('custom');
  const [carregandoPadrao, setCarregandoPadrao] = useState(false);
  const [substituindo, setSubstituindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (customTemplate) return;
    setCarregandoPadrao(true);
    carregarTemplatePadrao()
      .then((template) => {
        setCustomTemplate(template);
        salvarTemplateCustomizado(template);
      })
      .catch((err) => setErro(`Could not load the default template: ${mensagemErro(err)}`))
      .finally(() => setCarregandoPadrao(false));
    // Só na 1ª renderização sem template salvo — depois disso quem muda o customTemplate é o upload/reset.
    // eslint-disable-next-line
  }, []);

  async function substituirTemplate(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;

    setSubstituindo(true);
    setErro(null);
    try {
      const template = await parseTemplateDocx(arquivo);
      setCustomTemplate(template);
      salvarTemplateCustomizado(template);
      setSelecionadoId('custom');
    } catch (err) {
      setErro(`Could not read that .docx as a template: ${mensagemErro(err)}`);
    } finally {
      setSubstituindo(false);
    }
  }

  async function resetarTemplate() {
    limparTemplateCustomizadoSalvo();
    setCarregandoPadrao(true);
    setErro(null);
    try {
      const template = await carregarTemplatePadrao();
      setCustomTemplate(template);
      salvarTemplateCustomizado(template);
      setSelecionadoId('custom');
    } catch (err) {
      setErro(`Could not load the default template: ${mensagemErro(err)}`);
    } finally {
      setCarregandoPadrao(false);
    }
  }

  const opcoes: Template[] = customTemplate ? [customTemplate, ...TEMPLATES] : TEMPLATES;
  const templateAtivo = selecionadoId === 'custom' ? (customTemplate ?? TEMPLATES[0]) : buscarTemplate(selecionadoId);

  return {
    opcoes,
    selecionadoId,
    setSelecionadoId,
    templateAtivo,
    carregandoPadrao,
    substituindo,
    erro,
    substituirTemplate,
    resetarTemplate,
    temTemplateCustomizado: customTemplate !== null,
  };
}
