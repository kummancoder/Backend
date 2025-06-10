import language from '@google-cloud/language';
import logger from '../utils/logger.js';

class SentimentAnalysisService {
  constructor() {
    this.client = new language.LanguageServiceClient({
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
    });
  }

  async analyzeSentiment(text) {
    try {
      if (!text || text.trim().length === 0) {
        throw new Error('Text is required for sentiment analysis');
      }

      const document = {
        content: text,
        type: 'PLAIN_TEXT',
      };

      // Analyze sentiment
      const [sentimentResult] = await this.client.analyzeSentiment({
        document: document,
      });

      // Analyze entities
      const [entitiesResult] = await this.client.analyzeEntities({
        document: document,
      });

      // Analyze syntax for additional insights
      const [syntaxResult] = await this.client.analyzeSyntax({
        document: document,
      });

      const sentiment = sentimentResult.documentSentiment;
      const entities = entitiesResult.entities;
      const tokens = syntaxResult.tokens;

      // Calculate additional metrics
      const analysis = {
        // Overall sentiment
        sentiment: {
          score: sentiment.score, // Range: -1.0 (negative) to 1.0 (positive)
          magnitude: sentiment.magnitude, // Range: 0.0 to infinity (emotional intensity)
          label: this.getSentimentLabel(sentiment.score),
          confidence: this.calculateConfidence(sentiment.score, sentiment.magnitude)
        },

        // Emotional indicators
        emotions: this.extractEmotions(text, sentiment, entities),

        // Communication quality metrics
        communication: {
          wordCount: tokens.length,
          averageWordLength: this.calculateAverageWordLength(tokens),
          complexityScore: this.calculateComplexityScore(tokens),
          fluencyScore: this.calculateFluencyScore(text, tokens),
          clarityScore: this.calculateClarityScore(entities, tokens)
        },

        // Key entities and topics
        entities: entities.map(entity => ({
          name: entity.name,
          type: entity.type,
          salience: entity.salience, // Importance in the text
          sentiment: entity.sentiment ? {
            score: entity.sentiment.score,
            magnitude: entity.sentiment.magnitude
          } : null
        })),

        // Confidence and nervousness indicators
        confidence: {
          level: this.assessConfidenceLevel(text, sentiment, tokens),
          indicators: this.getConfidenceIndicators(text, tokens),
          nervousnessScore: this.calculateNervousnessScore(text, tokens)
        },

        // Response quality
        quality: {
          relevanceScore: this.calculateRelevanceScore(entities),
          depthScore: this.calculateDepthScore(text, entities),
          structureScore: this.calculateStructureScore(text, tokens)
        }
      };

      logger.info(`Sentiment analysis completed. Score: ${sentiment.score}, Magnitude: ${sentiment.magnitude}`);

      return analysis;

    } catch (error) {
      logger.error('Error in sentiment analysis:', error);
      throw new Error('Failed to analyze sentiment');
    }
  }

  getSentimentLabel(score) {
    if (score >= 0.25) return 'positive';
    if (score <= -0.25) return 'negative';
    return 'neutral';
  }

  calculateConfidence(score, magnitude) {
    // Higher magnitude with clear positive/negative score indicates higher confidence
    const absScore = Math.abs(score);
    return Math.min(1.0, (absScore * magnitude) / 2);
  }

  extractEmotions(text, sentiment, entities) {
    const emotions = {
      confidence: 0,
      nervousness: 0,
      enthusiasm: 0,
      uncertainty: 0,
      stress: 0
    };

    // Analyze text patterns for emotional indicators
    const lowerText = text.toLowerCase();

    // Confidence indicators
    const confidenceWords = ['confident', 'sure', 'certain', 'definitely', 'absolutely', 'clearly'];
    emotions.confidence = this.countWordMatches(lowerText, confidenceWords) * 0.2;

    // Nervousness indicators
    const nervousnessWords = ['um', 'uh', 'er', 'well', 'actually', 'you know', 'like'];
    emotions.nervousness = this.countWordMatches(lowerText, nervousnessWords) * 0.15;

    // Enthusiasm indicators
    const enthusiasmWords = ['excited', 'passionate', 'love', 'amazing', 'excellent', 'fantastic'];
    emotions.enthusiasm = this.countWordMatches(lowerText, enthusiasmWords) * 0.25;

    // Uncertainty indicators
    const uncertaintyWords = ['maybe', 'perhaps', 'might', 'could', 'possibly', 'not sure'];
    emotions.uncertainty = this.countWordMatches(lowerText, uncertaintyWords) * 0.2;

    // Stress indicators
    const stressWords = ['difficult', 'challenging', 'hard', 'struggle', 'pressure'];
    emotions.stress = this.countWordMatches(lowerText, stressWords) * 0.2;

    // Normalize scores
    Object.keys(emotions).forEach(key => {
      emotions[key] = Math.min(1.0, emotions[key]);
    });

    return emotions;
  }

  countWordMatches(text, words) {
    return words.reduce((count, word) => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = text.match(regex);
      return count + (matches ? matches.length : 0);
    }, 0);
  }

  calculateAverageWordLength(tokens) {
    if (tokens.length === 0) return 0;
    const totalLength = tokens.reduce((sum, token) => sum + token.text.content.length, 0);
    return totalLength / tokens.length;
  }

  calculateComplexityScore(tokens) {
    if (tokens.length === 0) return 0;
    
    // Count complex words (more than 6 characters)
    const complexWords = tokens.filter(token => 
      token.text.content.length > 6 && 
      token.partOfSpeech.tag !== 'PUNCT'
    ).length;
    
    return Math.min(1.0, complexWords / tokens.length * 2);
  }

  calculateFluencyScore(text, tokens) {
    if (tokens.length === 0) return 0;
    
    // Calculate based on sentence structure and flow
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgSentenceLength = tokens.length / sentences.length;
    
    // Optimal sentence length is around 15-20 words
    const optimalLength = 17.5;
    const lengthScore = 1 - Math.abs(avgSentenceLength - optimalLength) / optimalLength;
    
    return Math.max(0, Math.min(1.0, lengthScore));
  }

  calculateClarityScore(entities, tokens) {
    if (tokens.length === 0) return 0;
    
    // Higher entity salience indicates clearer communication
    const totalSalience = entities.reduce((sum, entity) => sum + entity.salience, 0);
    return Math.min(1.0, totalSalience);
  }

  assessConfidenceLevel(text, sentiment, tokens) {
    const score = sentiment.score;
    const magnitude = sentiment.magnitude;
    
    // Combine sentiment with linguistic patterns
    const baseConfidence = (score + 1) / 2; // Normalize to 0-1
    const intensityBonus = Math.min(0.3, magnitude / 3);
    
    return Math.min(1.0, baseConfidence + intensityBonus);
  }

  getConfidenceIndicators(text, tokens) {
    const indicators = [];
    const lowerText = text.toLowerCase();
    
    // Positive indicators
    if (lowerText.includes('i am confident') || lowerText.includes('i believe')) {
      indicators.push('Direct confidence statements');
    }
    
    if (tokens.some(token => token.partOfSpeech.tag === 'ADV' && 
        ['definitely', 'certainly', 'absolutely'].includes(token.text.content.toLowerCase()))) {
      indicators.push('Strong adverbs');
    }
    
    // Negative indicators
    if (lowerText.includes('i think') || lowerText.includes('i guess')) {
      indicators.push('Tentative language');
    }
    
    const fillerCount = this.countWordMatches(lowerText, ['um', 'uh', 'er', 'like', 'you know']);
    if (fillerCount > 2) {
      indicators.push('Excessive filler words');
    }
    
    return indicators;
  }

  calculateNervousnessScore(text, tokens) {
    const lowerText = text.toLowerCase();
    
    // Count nervousness indicators
    const fillerWords = this.countWordMatches(lowerText, ['um', 'uh', 'er', 'well']);
    const hesitationWords = this.countWordMatches(lowerText, ['actually', 'you know', 'like']);
    const repetitions = this.countRepetitions(tokens);
    
    const totalIndicators = fillerWords + hesitationWords + repetitions;
    const wordCount = tokens.length;
    
    return Math.min(1.0, totalIndicators / Math.max(1, wordCount) * 10);
  }

  countRepetitions(tokens) {
    const words = tokens.map(token => token.text.content.toLowerCase());
    const wordCounts = {};
    
    words.forEach(word => {
      if (word.length > 3) { // Only count significant words
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      }
    });
    
    return Object.values(wordCounts).filter(count => count > 1).length;
  }

  calculateRelevanceScore(entities) {
    // Score based on presence of relevant entities for UPSC context
    const relevantTypes = ['PERSON', 'ORGANIZATION', 'LOCATION', 'EVENT'];
    const relevantEntities = entities.filter(entity => 
      relevantTypes.includes(entity.type) && entity.salience > 0.1
    );
    
    return Math.min(1.0, relevantEntities.length / 5);
  }

  calculateDepthScore(text, entities) {
    // Score based on text length and entity diversity
    const wordCount = text.split(/\s+/).length;
    const entityTypes = new Set(entities.map(entity => entity.type));
    
    const lengthScore = Math.min(1.0, wordCount / 100); // Optimal around 100 words
    const diversityScore = Math.min(1.0, entityTypes.size / 5);
    
    return (lengthScore + diversityScore) / 2;
  }

  calculateStructureScore(text, tokens) {
    // Score based on sentence structure and organization
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    if (sentences.length === 0) return 0;
    
    // Check for transition words
    const transitionWords = ['however', 'therefore', 'furthermore', 'moreover', 'additionally'];
    const hasTransitions = transitionWords.some(word => 
      text.toLowerCase().includes(word)
    );
    
    const baseScore = 0.5;
    const transitionBonus = hasTransitions ? 0.3 : 0;
    const lengthPenalty = sentences.length === 1 ? -0.2 : 0;
    
    return Math.max(0, Math.min(1.0, baseScore + transitionBonus + lengthPenalty));
  }
}

export const sentimentAnalysisService = new SentimentAnalysisService();