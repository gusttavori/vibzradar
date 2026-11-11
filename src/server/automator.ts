/**
 * Radar Vibz - Script de Automação de Varredura
 * Varre os perfis cadastrados no banco e envia para o Webhook de análise
 */

import { db } from './database';
import fetch from 'node-fetch'; // ou use o fetch nativo do Node.js 18+

async function runAutomatedScan() {
  console.log('🤖 [Radar Vibz Automator] Iniciando ciclo de varredura automática...');

  try {
    // 1. Busca todos os perfis ativos cadastrados no banco
    const profiles = await db.getProfiles();
    const activeProfiles = profiles.filter(p => p.monitoringStatus === 'active');

    console.log(`🔍 Encontrados ${activeProfiles.length} perfis ativos para monitoramento.`);

    for (const profile of activeProfiles) {
      console.log(`📡 Verificando publicações recentes para: @${profile.username}`);

      // Exemplo de payload simulando uma varredura automatizada de um post recente do perfil
      // Em produção, aqui entraria a chamada para uma API de extração ou RSS
      const samplePost = {
        username: profile.username,
        externalId: `auto_${profile.username}_${Date.now()}`,
        caption: `🎉 AGENDA DA SEMANA em ${profile.city}! Quinta tem show ao vivo com grandes atrações e promoções de chopp. Não fique de fora, garanta seu ingresso!`,
        originalUrl: `https://instagram.com/${profile.username}`,
        mediaType: 'IMAGE',
        thumbnailUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=150&auto=format&fit=crop',
        publishedAt: new Date().toISOString()
      };

      // Dispara para o webhook local do próprio servidor
      const response = await fetch('http://localhost:3000/api/publications/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(samplePost)
      });

      const result: any = await response.json();
      if (result.success) {
        console.log(`✅ Post processado para @${profile.username} | Oportunidade gerada: ${result.data.opportunity ? 'SIM' : 'NÃO'}`);
      } else {
        console.warn(`⚠️ Falha ao processar @${profile.username}:`, result.error);
      }
    }

    console.log('✨ [Radar Vibz Automator] Ciclo de varredura concluído com sucesso!');
  } catch (err) {
    console.error('❌ Erro na execução da automação:', err);
  }
}

// Executa se chamado diretamente
runAutomatedScan();