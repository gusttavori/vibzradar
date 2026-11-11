/**
 * Radar Vibz - Notification Service
 * Envio de alertas de oportunidades via Telegram com suporte a múltiplos destinatários
 */

import { db } from '../database';
import { Opportunity } from '../types/radar';

export class NotificationService {
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

      // Separa múltiplos IDs informados por vírgula no .env ou no banco
      const chatIds = settings.telegram.chatId
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

      if (chatIds.length === 0) return false;

      const relevanceEmoji =
        opportunity.relevance === 'high'
          ? '🔴 *ALTA RELEVÂNCIA*'
          : opportunity.relevance === 'medium'
          ? '🟡 *MÉDIA RELEVÂNCIA*'
          : '🟢 *BAIXA RELEVÂNCIA*';

      const messageText = [
        `🚨 *NOVA OPORTUNIDADE DETECTADA* 🚨`,
        ``,
        `📍 *Evento:* ${opportunity.eventName}`,
        `🏢 *Perfil:* @${opportunity.username}`,
        `📊 *Relevância:* ${relevanceEmoji}`,
        `🏷️ *Categoria:* ${opportunity.category}`,
        `🏙️ *Local:* ${opportunity.venue || 'N/I'} (${opportunity.city})`,
        opportunity.eventDate ? `📅 *Data:* ${opportunity.eventDate}` : null,
        ``,
        `💡 *Oportunidade Comercial:*`,
        `${opportunity.commercialPotential || 'Não especificada'}`,
        ``,
        `🎯 *Ação Sugerida:*`,
        `${opportunity.suggestedAction || 'Verificar publicação no Radar Vibz'}`,
        ``,
        opportunity.originalUrl ? `🔗 [Ver publicação original no Instagram](${opportunity.originalUrl})` : null,
      ]
        .filter(Boolean)
        .join('\n');

      let successCount = 0;

      for (const chatId of chatIds) {
        try {
          const url = `https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: messageText,
              parse_mode: 'Markdown',
              disable_web_page_preview: false,
            }),
          });

          if (response.ok) {
            successCount++;
          } else {
            const errData = await response.json();
            console.warn(`[Telegram Error] Falha ao enviar para Chat ID ${chatId}:`, errData);
          }
        } catch (err) {
          console.error(`[Telegram Error] Erro de rede ao notificar ${chatId}:`, err);
        }
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
  async sendTestNotification(): Promise<{ success: boolean; message: string }> {
    try {
      const settings = await db.getSettings();

      if (!settings.telegram.botToken || !settings.telegram.chatId) {
        return {
          success: false,
          message: 'Token ou Chat ID(s) do Telegram não configurados.',
        };
      }

      const chatIds = settings.telegram.chatId
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

      let successCount = 0;

      for (const chatId of chatIds) {
        const url = `https://api.telegram.org/bot${settings.telegram.botToken}/sendMessage`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: '⚡ *Radar Vibz*: Teste de integração do Telegram efetuado com sucesso! Múltiplos destinatários ativos.',
            parse_mode: 'Markdown',
          }),
        });

        if (response.ok) successCount++;
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