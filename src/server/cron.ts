/**
 * Radar Vibz - Agendador Automático de Varredura (Node-Cron)
 * Roda periodicamente em segundo plano buscando os perfis ativos e enviando para o Webhook
 */

import cron from 'node-cron';
import { db } from './database';

export function initAutomatedScheduler() {
  // Roda a cada 30 minutos (ou ajuste conforme sua preferência, ex: '0 * * * *' para cada 1 hora)
  cron.schedule('*/30 * * * *', async () => {
    console.log('🤖 [Radar Vibz Cron] Iniciando varredura periódica automática...');

    try {
      const profiles = await db.getProfiles();
      const activeProfiles = profiles.filter(p => p.monitoringStatus === 'active');

      if (activeProfiles.length === 0) {
        console.log('⚠️ [Radar Vibz Cron] Nenhum perfil ativo encontrado para varredura.');
        return;
      }

      for (const profile of activeProfiles) {
        // Exemplo de publicação simulada obtida de forma automatizada do perfil
        const samplePost = {
          username: profile.username,
          externalId: `cron_${profile.username}_${Date.now()}`,
          caption: `🔥 EVENTO CONFIRMADO em ${profile.city}! Fim de semana com programação especial e grandes atrações. Garanta seu ingresso antecipado!`,
          originalUrl: `https://instagram.com/${profile.username}`,
          mediaType: 'IMAGE',
          thumbnailUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150&auto=format&fit=crop',
          publishedAt: new Date().toISOString()
        };

        // Dispara internamente para o próprio Webhook do Express
        const response = await fetch('http://localhost:3000/api/publications/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(samplePost)
        });

        const result: any = await response.json();
        if (result.success) {
          console.log(`✅ [Cron] Perfil @${profile.username} varrido com sucesso. Oportunidade: ${result.data.opportunity ? 'GERADA' : 'NÃO'}`);
        }
      }
    } catch (err) {
      console.error('❌ [Radar Vibz Cron] Erro durante o ciclo automático:', err);
    }
  });

  console.log('🚀 [Radar Vibz] Agendador automático de varredura ativado com sucesso!');
}