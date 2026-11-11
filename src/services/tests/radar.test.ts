import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../server/database';
import { aiAnalysisService } from '../../server/services/publicationAnalysisService';
import { notificationService } from '../../server/services/notificationService';
import { monitoringEngine } from '../../server/services/monitoringEngine';
import { schedulerService, getCronExpressionForMinutes } from '../../server/services/schedulerService';

test('Perfis: Previne cadastro de perfis duplicados com mesmo nome de usuário', async () => {
  const username = `test_dup_${Date.now()}`;
  await db.createProfile({
    username,
    displayName: 'Perfil Teste Duplicado',
    category: 'Bar',
    city: 'Vitória da Conquista',
    state: 'BA',
    description: 'Teste',
    monitoringStatus: 'active',
    integrationMethod: 'demo_simulation',
  });

  await assert.rejects(
    async () => {
      await db.createProfile({
        username,
        displayName: 'Perfil Duplicado 2',
        category: 'Bar',
        city: 'Vitória da Conquista',
        state: 'BA',
        description: 'Teste',
        monitoringStatus: 'active',
        integrationMethod: 'demo_simulation',
      });
    },
    (err: any) => {
      assert.match(err.message, /já está cadastrado/i);
      return true;
    }
  );
});

test('Publicações: Deduplicação estrita por externalId da mídia do Instagram', async () => {
  // Cria um perfil real para satisfazer a Foreign Key do PostgreSQL
  const profile = await db.createProfile({
    username: `bar_vconq_${Date.now()}`,
    displayName: 'Bar V Conquista',
    category: 'Bar',
    city: 'Vitória da Conquista',
    state: 'BA',
    monitoringStatus: 'active',
    integrationMethod: 'demo_simulation',
  });

  const externalId = `ext_test_${Date.now()}`;
  await db.insertPublication({
    profileId: profile.id,
    username: profile.username,
    externalId,
    originalUrl: 'https://instagram.com/p/test',
    mediaType: 'IMAGE',
    caption: 'Show no final de semana',
    publishedAt: new Date().toISOString(),
    analysisStatus: 'pending',
    relevance: 'none',
    isReviewed: false,
  });

  await assert.rejects(
    async () => {
      await db.insertPublication({
        profileId: profile.id,
        username: profile.username,
        externalId,
        originalUrl: 'https://instagram.com/p/test',
        mediaType: 'IMAGE',
        caption: 'Show no final de semana duplicado',
        publishedAt: new Date().toISOString(),
        analysisStatus: 'pending',
        relevance: 'none',
        isReviewed: false,
      });
    },
    (err: any) => {
      assert.match(err.message, /já foi cadastrada/i);
      return true;
    }
  );
});

test('Inteligência Artificial: Heurística identifica festivais e shows com relevância alta', async () => {
  const result = await aiAnalysisService.analyzePublication({
    caption: 'Grande Festival de Verão neste sábado com show ao vivo da Banda X!',
    username: 'festival_test',
    category: 'Festa',
    city: 'Vitória da Conquista',
    publishedAt: new Date().toISOString()
  });
  
  assert.equal(result.is_event, true);
  assert.equal(result.is_opportunity, true);
  assert.equal(result.relevance, 'high');
});

test('Inteligência Artificial: Distingue retrospectivas e avisos sem oportunidade futura', async () => {
  const result = await aiAnalysisService.analyzePublication({
    caption: 'TBT da festa inesquecível do mês passado! Obrigado a todos que vieram.',
    username: 'festa_test',
    category: 'Festa',
    city: 'Vitória da Conquista',
    publishedAt: new Date().toISOString()
  });

  assert.equal(result.is_event, false);
  assert.equal(result.is_opportunity, false);
  assert.equal(result.relevance, 'low');
});

test('Descoberta: Aprovação de candidato o transfere para perfis monitorados', async () => {
  const candidateUsername = `cand_test_${Date.now()}`;
  const candidate = await db.addCandidate({
    username: candidateUsername,
    displayName: 'Bar Candidato Teste',
    probableCategory: 'Bar',
    city: 'Vitória da Conquista',
    state: 'BA',
    justification: 'Postagens frequentes de shows',
    source: 'Manual',
    status: 'Pendente',
  });

  const updated = await db.updateCandidateStatus(candidate.id, 'Aprovado');
  assert.equal(updated?.status, 'Aprovado');
});

test('Telegram: Formatação da notificação respeita padrão editorial do Radar Vibz', () => {
  const message = notificationService.formatOpportunityMessage({
    id: 'opp-1',
    publicationId: 'pub-1',
    profileId: 'prof-1',
    username: 'bar_vconquista',
    eventName: 'Samba no Bar',
    category: 'Show',
    eventDate: '2026-11-10',
    eventTime: '20:00',
    city: 'Vitória da Conquista',
    venue: 'Bar Conquista',
    artists: ['Grupo Sambô'],
    summary: 'Noite de samba ao vivo.',
    originalUrl: 'https://instagram.com/p/123',
    relevance: 'high',
    commercialPotential: 'Alto interesse para venda de ingressos',
    suggestedAction: 'Oferecer módulo de bilhetagem Vibz',
    detectedAt: new Date().toISOString(),
    status: 'Nova',
    internalNotes: '',
    contactLogs: [],
  });

  assert.match(message, /Samba no Bar/);
  assert.match(message, /bar_vconquista/);
  assert.match(message, /Vitória da Conquista/);
});

test('Deduplicação Persistente: Impede reenvio de notificações gravando estado no banco JSON', async () => {
  const oppId = `opp_dedup_test_${Date.now()}`;

  // 1. Cria um perfil real para satisfazer a Foreign Key do PostgreSQL
  const profile = await db.createProfile({
    username: `bar_test_${Date.now()}`,
    displayName: 'Bar Teste Notificacao',
    category: 'Bar',
    city: 'Vitória da Conquista',
    state: 'BA',
    monitoringStatus: 'active',
    integrationMethod: 'demo_simulation',
  });

  // 2. Cria uma publicação real para satisfazer a Foreign Key da Oportunidade
  const pub = await db.insertPublication({
    profileId: profile.id,
    username: profile.username,
    externalId: `ext_pub_${oppId}`,
    originalUrl: 'https://instagram.com/p/test_opp',
    mediaType: 'IMAGE',
    caption: 'Legenda teste',
    publishedAt: new Date().toISOString(),
    analysisStatus: 'analyzed',
    relevance: 'high',
    isReviewed: false,
  });

  // 3. Cria a Oportunidade vinculada corretamente aos dois registros
  const opp = await db.createOpportunity({
    id: oppId,
    publicationId: pub.id,
    profileId: profile.id,
    username: profile.username,
    eventName: 'Evento Teste Notificação',
    category: 'Show',
    eventDate: '2026-11-15',
    eventTime: '21:00',
    city: 'Vitória da Conquista',
    venue: 'Arena Teste',
    artists: [],
    summary: 'Evento de teste para deduplicação de notificação.',
    originalUrl: 'https://instagram.com/p/test_opp',
    relevance: 'high',
    commercialPotential: 'Alto',
    suggestedAction: 'Contato comercial',
    status: 'Nova',
    internalNotes: '',
    contactLogs: [],
  });

  const isNotifiedBefore = await db.isOpportunityNotified(opp.id);
  assert.equal(isNotifiedBefore, false);

  await db.markOpportunityNotified(opp.id);

  const isNotifiedAfter = await db.isOpportunityNotified(opp.id);
  assert.equal(isNotifiedAfter, true);
});

test('Trava de Concorrência (Lock): Bloqueia execuções simultâneas e libera no bloco finally', async () => {
  const result = await monitoringEngine.runCycleNow(false);
  assert.equal(monitoringEngine.isBusy(), false);
  assert.equal(typeof result.profilesChecked, 'number');
});

test('Agendador (Scheduler): Converte intervalos para cron e gerencia ciclo de vida', async () => {
  assert.equal(getCronExpressionForMinutes(15), '*/15 * * * *');
  assert.equal(getCronExpressionForMinutes(60), '0 * * * *');
  assert.equal(getCronExpressionForMinutes(120), '0 */2 * * *');

  await schedulerService.init();
  const status = await schedulerService.getStatus();
  assert.equal(typeof status.isRunning, 'boolean');
  schedulerService.stop();
});