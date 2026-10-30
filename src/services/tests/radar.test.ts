/**
 * Radar Vibz - Pure Logic & Integration Unit Tests
 * Executado via node:test e tsx
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../server/database';
import { aiAnalysisService } from '../../server/services/publicationAnalysisService';
import { notificationService } from '../../server/services/notificationService';
import { monitoringEngine } from '../../server/services/monitoringEngine';
import { schedulerService, getCronExpressionForMinutes } from '../../server/services/schedulerService';
import { Opportunity } from '../../types/radar';

test('Perfis: Previne cadastro de perfis duplicados com mesmo nome de usuário', () => {
  const initialCount = db.getProfiles().length;
  // Try inserting an existing profile username (e.g. @arena_sudoeste_eventos)
  const result = db.createProfile({
    username: 'arena_sudoeste_eventos',
    displayName: 'Arena Duplicada Teste',
    profileUrl: 'https://instagram.com/arena_sudoeste_eventos',
    category: 'Casa de eventos',
    city: 'Vitória da Conquista',
    state: 'BA',
    description: 'Teste',
    monitoringStatus: 'active',
    integrationMethod: 'demo_simulation'
  });

  assert.equal(result.success, false);
  assert.match(result.error || '', /já está cadastrado/i);
  assert.equal(db.getProfiles().length, initialCount);
});

test('Publicações: Deduplicação estrita por externalId da mídia do Instagram', () => {
  const existingExternalId = 'ig_media_90812301_01';
  const initialTotal = db.getPublications().length;

  const duplicateInsert = db.insertPublication({
    profileId: 'prof-01',
    username: 'arena_sudoeste_eventos',
    externalId: existingExternalId,
    originalUrl: 'https://instagram.com/p/DB123456781',
    mediaType: 'IMAGE',
    caption: 'Tentativa de duplicação',
    publishedAt: '2026-10-29T14:30:00.000Z',
    analysisStatus: 'analyzed',
    relevance: 'high',
    isReviewed: true
  });

  assert.equal(duplicateInsert.created, false);
  assert.equal(duplicateInsert.publication.externalId, existingExternalId);
  assert.equal(db.getPublications().length, initialTotal);
});

test('Inteligência Artificial: Heurística identifica festivais e shows com relevância alta', () => {
  const festivalCaption = 'MEGA FESTIVAL DE VERÃO 2026! ☀️ Dia 18 de Novembro em Vitória da Conquista. Ingressos 1º lote já disponíveis!';
  const result = aiAnalysisService.heuristicAnalysis({
    caption: festivalCaption,
    username: 'produtora_teste',
    category: 'Produtora',
    city: 'Vitória da Conquista',
    publishedAt: '2026-10-29T12:00:00Z'
  });

  assert.equal(result.is_event, true);
  assert.equal(result.is_opportunity, true);
  assert.equal(result.relevance, 'high');
  assert.ok(result.event_name && result.event_name.length > 0);
  assert.ok(result.commercial_opportunity.length > 0);
});

test('Inteligência Artificial: Distingue retrospectivas e avisos sem oportunidade futura', () => {
  const retroCaption = 'Obrigado a todos que compareceram ontem à nossa festa! Que energia linda foi curtir com vocês até o amanhecer.';
  const result = aiAnalysisService.heuristicAnalysis({
    caption: retroCaption,
    username: 'bar_teste',
    category: 'Bar',
    city: 'Vitória da Conquista',
    publishedAt: '2026-10-29T12:00:00Z'
  });

  assert.equal(result.is_event, false);
  assert.equal(result.is_opportunity, false);
  assert.equal(result.relevance, 'low');
  assert.equal(result.category, 'Retrospectiva');
});

test('Descoberta: Aprovação de candidato o transfere para perfis monitorados', () => {
  const testUser = `cand_teste_${Date.now()}`;
  const candidate = db.addCandidate({
    username: testUser,
    displayName: 'Novo Espaço Show [Teste]',
    probableCategory: 'Casa de eventos',
    city: 'Vitória da Conquista',
    state: 'BA',
    justification: 'Show de forró programado',
    source: 'Teste Unitário'
  });

  assert.equal(candidate.status, 'Pendente');

  const approval = db.approveCandidate(candidate.id);
  assert.equal(approval.success, true);
  assert.ok(approval.profile);
  assert.equal(approval.profile?.username, testUser);

  // Verify in profiles list
  const createdProfile = db.getProfileByUsername(testUser);
  assert.ok(createdProfile);
  assert.equal(createdProfile?.monitoringStatus, 'active');

  // Limpeza para manter banco consistente
  db.deleteProfile(createdProfile.id);
});

test('Telegram: Formatação da notificação respeita padrão editorial do Radar Vibz', () => {
  const sampleOpp: Opportunity = {
    id: 'opp-test-123',
    publicationId: 'pub-test-1',
    profileId: 'prof-test-1',
    username: 'arena_teste',
    eventName: 'Micareta Universitária Conquista',
    category: 'Festa',
    eventDate: '2026-11-20',
    eventTime: '22:00',
    city: 'Vitória da Conquista',
    venue: 'Arena Teste',
    artists: ['Banda Bahia', 'DJ Conquista'],
    summary: 'Grande micareta com trio elétrico.',
    originalUrl: 'https://instagram.com/p/test123',
    relevance: 'high',
    commercialPotential: 'Venda de 2.000 abadás com taxa Vibz.',
    suggestedAction: 'Contatar comissão de formatura.',
    detectedAt: '2026-10-29T19:00:00Z',
    status: 'Nova',
    internalNotes: '',
    contactLogs: []
  };

  const message = notificationService.formatOpportunityMessage(sampleOpp);
  assert.match(message, /RADAR VIBZ/);
  assert.match(message, /NOVA OPORTUNIDADE IDENTIFICADA/);
  assert.match(message, /@arena_teste/);
  assert.match(message, /Micareta Universitária Conquista/);
  assert.match(message, /ALTA/);
});

test('Deduplicação Persistente: Impede reenvio de notificações gravando estado no banco JSON', async () => {
  const oppId = `opp_dedup_test_${Date.now()}`;
  const opp = db.createOpportunity({
    publicationId: `pub_${oppId}`,
    profileId: 'prof-01',
    username: 'arena_sudoeste_eventos',
    eventName: 'Show de Teste Deduplicação Persistente',
    category: 'Show musical',
    eventDate: '2026-12-31',
    eventTime: '21:00',
    city: 'Vitória da Conquista',
    venue: 'Arena Sudoeste',
    artists: ['Artista Teste'],
    summary: 'Evento de teste para validação de deduplicação no banco JSON.',
    originalUrl: 'https://instagram.com/p/test_dedup',
    relevance: 'high',
    commercialPotential: 'Validação de deduplicação.',
    suggestedAction: 'Validar persistência.',
    status: 'Nova',
    internalNotes: 'Teste unitário Etapa 2',
    isDemo: true
  });

  // 1. Inicialmente não deve constar como notificado
  assert.equal(db.isOpportunityNotified(opp.id), false);

  // 2. Dispara notificação (em modo simulado)
  const firstDispatch = await notificationService.notifyOpportunity(opp);
  assert.equal(firstDispatch.success, true);

  // 3. Verifica se foi gravado persistentemente no banco JSON
  assert.equal(db.isOpportunityNotified(opp.id), true);
  assert.ok(db.getNotifiedOpportunityIds().includes(opp.id));

  // 4. Tentativa de reenvio deve ser rejeitada pela checagem no JSON
  const secondDispatch = await notificationService.notifyOpportunity(opp);
  assert.equal(secondDispatch.success, false);
  assert.match(secondDispatch.message, /deduplicada no banco JSON/i);
});

test('Trava de Concorrência (Lock): Bloqueia execuções simultâneas e libera no bloco finally', async () => {
  assert.equal(monitoringEngine.isLocked(), false);

  // Simula ativação do Lock de concorrência
  (monitoringEngine as unknown as { isMonitoring: boolean }).isMonitoring = true;
  assert.equal(monitoringEngine.isLocked(), true);

  // Disparo manual deve lançar erro
  await assert.rejects(
    async () => {
      await monitoringEngine.runCycleNow(false);
    },
    { message: /já está em andamento/i }
  );

  // Disparo agendado deve pular a execução e retornar skipped: true
  const scheduledSkip = await monitoringEngine.runCycleNow(true);
  assert.equal(scheduledSkip.skipped, true);
  assert.match(scheduledSkip.details, /trava de concorrência \(Lock\) ativa/i);

  // Libera a trava e verifica execução normal com liberação garantida no finally
  (monitoringEngine as unknown as { isMonitoring: boolean }).isMonitoring = false;
  assert.equal(monitoringEngine.isLocked(), false);

  const normalRun = await monitoringEngine.runCycleNow();
  assert.equal(normalRun.skipped, undefined);
  assert.equal(monitoringEngine.isLocked(), false); // Garantido pelo bloco finally
});

test('Agendador (Scheduler): Converte intervalos para cron e gerencia ciclo de vida', () => {
  // Conversão de intervalos
  assert.equal(getCronExpressionForMinutes(15), '*/15 * * * *');
  assert.equal(getCronExpressionForMinutes(30), '*/30 * * * *');
  assert.equal(getCronExpressionForMinutes(60), '0 * * * *');
  assert.equal(getCronExpressionForMinutes(180), '0 */3 * * *');
  assert.equal(getCronExpressionForMinutes(360), '0 */6 * * *');

  // Inicialização e consulta de status
  schedulerService.init();
  const status = schedulerService.getStatus();
  assert.equal(status.isRunning, true);
  assert.equal(status.autoScheduled, true);
  assert.equal(typeof status.intervalMinutes, 'number');
  assert.ok(status.cronExpression);

  // Parada limpa
  schedulerService.stop();
  assert.equal(schedulerService.getStatus().isRunning, false);
});
