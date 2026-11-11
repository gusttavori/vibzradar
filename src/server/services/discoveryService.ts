/**
 * Radar Vibz - Discovery Service
 * Motor de busca 100% automatizado e real via Apify
 */

import { db } from '../database';
import { ProfileCandidate, ProfileCategory } from '../../types/radar';

export class DiscoveryService {
  /**
   * Executa a varredura automática utilizando o Apify para buscar perfis reais no Instagram
   */
  async discoverCandidates(params: {
    city?: string;
    category?: ProfileCategory;
    keyword?: string;
  }): Promise<ProfileCandidate[]> {
    const profiles = await db.getProfiles();
    const existingCandidates = await db.getCandidates();
    const existingUsernames = new Set(profiles.map(p => p.username.toLowerCase()));
    const settings = await db.getSettings();

    const added: ProfileCandidate[] = [];
    const searchTerm = params.keyword || params.category || 'eventos e shows';
    const targetCity = params.city || 'Vitória da Conquista';

    try {
      const apifyToken = process.env.APIFY_API_TOKEN || settings.instagram?.accessToken;

      if (apifyToken) {
        // Chamada real ao ator de busca do Apify para encontrar perfis no Instagram
        const response = await fetch(`https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${apifyToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            search: `${searchTerm} ${targetCity}`,
            searchType: 'user',
            resultsLimit: 15
          })
        });

        if (response.ok) {
          const results = await response.json();
          if (Array.isArray(results)) {
            for (const item of results) {
              const username = item.username || item.ownerUsername;
              if (!username) continue;

              const cleanUsername = username.toLowerCase();
              if (existingUsernames.has(cleanUsername)) continue;
              if (existingCandidates.some(c => c.username.toLowerCase() === cleanUsername)) continue;

              const cand = await db.addCandidate({
                username: cleanUsername,
                displayName: item.fullName || item.name || cleanUsername,
                probableCategory: params.category && params.category !== 'Todas as Categorias' ? params.category : 'Organizador',
                city: targetCity,
                state: 'BA',
                justification: item.biography || `Encontrado via automação regional para ${searchTerm}.`,
                source: 'Varredura Automática Apify',
                followersEstimated: item.followersCount || 5000,
                isDemo: false
              });

              if (cand) {
                added.push(cand);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Discovery Error] Falha na execução da busca automatizada via Apify:', err);
    }

    await db.logSystem(
      'PROFILES',
      'INFO',
      `Varredura automática de descoberta finalizada. ${added.length} novos perfis reais adicionados à fila de pendentes.`
    );

    return added;
  }
}

export const discoveryService = new DiscoveryService();