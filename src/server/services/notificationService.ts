/**
 * Radar Vibz - Notification Service
 * Envio de alertas de oportunidades via Telegram com suporte a múltiplos destinatários
 */

import { db } from '../database';
import { Opportunity } from '../../types/radar';

function escapeHtml(text: string | null | undefined): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export class NotificationService {
  /**
   * Envia mensagem via API do Telegram em HTML com fallback automático para texto puro
   */
  private async sendTelegramMessage(
    botToken: string,
    chatId: string,
    htmlText: string,
    disableWebPagePreview: boolean = false
  ): Promise<boolean> {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: htmlText,
          parse_mode: 'HTML',
          disable_web_page_preview: disableWebPagePreview,
        }),
      });

      if (response.ok) {
        return true;
      }

      const errData = await response.json().catch(() => ({}));
      console.warn(`[Telegram Error] Falha HTML para Chat ID ${chatId}:`, errData);

      // Fallback: se houver erro 400 de entidade/formatação, reenvia imediatamente em texto puro
      if (response.status === 400) {
        const plainResponse = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: stripHtml(htmlText),
            disable_web_page_preview: disableWebPagePreview,
          }),
        });

        if (plainResponse.ok) {
          console.log(`[Telegram] Mensagem reenviada em texto puro para Chat ID ${chatId}.`);
          return true;
        }
      }

      return false;
    } catch (err) {
      console.error(`[Telegram Error] Erro de rede ao notificar ${chatId}:`, err);
      return false;
    }
  }

  /**
   * Dispara alerta formatado no Telegram para todos os Chat IDs cadastrados
   */
  async notifyOpportunity(opportunity: Opportunity): Promise<boolean> {
    try {
      const settings = await db.getSettings();

      if (
        !settings.telegram.enabled ||
        !settings.telegram.botToken ||
        !settings.telegram.chatId
      ) {
        return false;
      }

      const chatIds = settings.telegram.chatId
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

      if (chatIds.length === 0) return false;

      const relevanceLabel =
        opportunity.relevance === 'high'
          ? '🔴 <b>ALTA RELEVÂNCIA</b>'
          : opportunity.relevance === 'medium'
          ? '🟡 <b>MÉDIA RELEVÂNCIA</b>'
          : '🟢 <b>BAIXA RELEVÂNCIA</b>';

      const cleanUsername = (opportunity.username || '').replace(/^@/, '');

      const messageHtml = [
        `🚨 <b>NOVA OPORTUNIDADE DETECTADA</b> 🚨`,
        ``,
        `📍 <b>Evento:</b> ${escapeHtml(opportunity.eventName)}`,
        `🏢 <b>Perfil:</b> @${escapeHtml(cleanUsername)}`,
        `📊 <b>Relevância:</b> ${relevanceLabel}`,
        `🏷️ <b>Categoria:</b> ${escapeHtml(opportunity.category)}`,
        `🏙️ <b>Local:</b> ${escapeHtml(opportunity.venue || 'N/I')} (${escapeHtml(opportunity.city)})`,
        opportunity.eventDate ? `📅 <b>Data:</b> ${escapeHtml(opportunity.eventDate)}` : null,
        ``,
        `💡 <b>Oportunidade Comercial:</b>`,
        `${escapeHtml(opportunity.commercialPotential || 'Não especificada')}`,
        ``,
        `🎯 <b>Ação Sugerida:</b>`,
        `${escapeHtml(opportunity.suggestedAction || 'Verificar publicação no Radar Vibz')}`,
        ``,
        opportunity.originalUrl
          ? `🔗 <a href="${escapeHtml(opportunity.originalUrl)}">Ver publicação original no Instagram</a>`
          : null,
      ]
        .filter((line) => line !== null)
        .join('\n');

      let successCount = 0;

      for (const chatId of chatIds) {
        const sent = await this.sendTelegramMessage(
          settings.telegram.botToken,
          chatId,
          messageHtml,
          false
        );
        if (sent) successCount++;
      }

      if (successCount > 0) {
        await db.markOpportunityNotified(opportunity.id);
        return true;
      }

      return false;
    } catch (err) {
      console.error('[NotificationService] Erro ao enviar notificação:', err);
      return false;
    }
  }

  /**
   * Envia uma mensagem de teste para todos os destinatários configurados
   */
  async sendTestNotification(
    customBotToken?: string,
    customChatId?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const settings = await db.getSettings();
      const botToken =
        customBotToken && !customBotToken.includes('•')
          ? customBotToken.trim()
          : settings.telegram.botToken;
      const rawChatIds = customChatId?.trim() || settings.telegram.chatId;

      if (!botToken || !rawChatIds) {
        return {
          success: false,
          message: 'Token ou Chat ID(s) do Telegram não configurados.',
        };
      }

      const chatIds = rawChatIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

      let successCount = 0;
      const testHtml =
        '⚡ <b>Radar Vibz</b>: Teste de integração do Telegram efetuado com sucesso! Múltiplos destinatários ativos.';

      for (const chatId of chatIds) {
        const sent = await this.sendTelegramMessage(botToken, chatId, testHtml, true);
        if (sent) successCount++;
      }

      return {
        success: successCount > 0,
        message: `Mensagem enviada com sucesso para ${successCount} de ${chatIds.length} destinatários!`,
      };
    } catch (err: unknown) {
      return {
        success: false,
        message: err instanceof Error ? err.message : 'Erro ao enviar mensagem de teste.',
      };
    }
  }
}

export const notificationService = new NotificationService();