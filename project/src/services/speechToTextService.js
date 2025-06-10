import speech from '@google-cloud/speech';
import logger from '../utils/logger.js';

class SpeechToTextService {
  constructor() {
    this.client = new speech.SpeechClient({
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
    });
  }

  async transcribeAudio(audioBuffer, options = {}) {
    try {
      const audioBytes = Buffer.from(audioBuffer, 'base64');

      const request = {
        audio: {
          content: audioBytes,
        },
        config: {
          encoding: options.encoding || 'WEBM_OPUS',
          sampleRateHertz: options.sampleRate || 48000,
          languageCode: options.languageCode || 'en-IN',
          alternativeLanguageCodes: ['hi-IN', 'en-US'],
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
          enableWordConfidence: true,
          model: 'latest_long',
          useEnhanced: true,
          profanityFilter: false,
          speechContexts: [
            {
              phrases: [
                'UPSC', 'IAS', 'IPS', 'IFS', 'civil services',
                'public administration', 'governance', 'policy',
                'constitution', 'fundamental rights', 'directive principles',
                'parliament', 'judiciary', 'executive', 'federalism'
              ],
              boost: 10.0
            }
          ]
        },
      };

      const [response] = await this.client.recognize(request);
      
      if (!response.results || response.results.length === 0) {
        logger.warn('No transcription results received');
        return null;
      }

      const transcription = response.results
        .map(result => result.alternatives[0].transcript)
        .join(' ')
        .trim();

      // Get confidence score
      const confidence = response.results.length > 0 
        ? response.results[0].alternatives[0].confidence 
        : 0;

      // Get word-level details
      const words = response.results
        .flatMap(result => result.alternatives[0].words || [])
        .map(word => ({
          word: word.word,
          startTime: word.startTime ? parseFloat(word.startTime.seconds) + parseFloat(word.startTime.nanos) / 1e9 : 0,
          endTime: word.endTime ? parseFloat(word.endTime.seconds) + parseFloat(word.endTime.nanos) / 1e9 : 0,
          confidence: word.confidence || 0
        }));

      logger.info(`Speech transcribed successfully. Confidence: ${confidence}, Length: ${transcription.length}`);

      return {
        transcription,
        confidence,
        words,
        languageCode: request.config.languageCode
      };

    } catch (error) {
      logger.error('Error in speech-to-text conversion:', error);
      throw new Error('Failed to transcribe audio');
    }
  }

  async transcribeStreamingAudio(audioStream, options = {}) {
    try {
      const request = {
        config: {
          encoding: options.encoding || 'WEBM_OPUS',
          sampleRateHertz: options.sampleRate || 48000,
          languageCode: options.languageCode || 'en-IN',
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: true,
          model: 'latest_short',
          useEnhanced: true
        },
        interimResults: true,
      };

      const recognizeStream = this.client
        .streamingRecognize(request)
        .on('error', (error) => {
          logger.error('Streaming recognition error:', error);
        });

      return recognizeStream;

    } catch (error) {
      logger.error('Error setting up streaming recognition:', error);
      throw new Error('Failed to setup streaming transcription');
    }
  }

  // Utility method to validate audio format
  validateAudioFormat(audioBuffer) {
    try {
      // Basic validation - check if buffer is not empty
      if (!audioBuffer || audioBuffer.length === 0) {
        return { valid: false, error: 'Empty audio buffer' };
      }

      // Check minimum size (at least 1KB)
      if (audioBuffer.length < 1024) {
        return { valid: false, error: 'Audio too short' };
      }

      // Check maximum size (10MB limit)
      if (audioBuffer.length > 10 * 1024 * 1024) {
        return { valid: false, error: 'Audio file too large' };
      }

      return { valid: true };

    } catch (error) {
      logger.error('Error validating audio format:', error);
      return { valid: false, error: 'Invalid audio format' };
    }
  }

  // Get supported languages
  getSupportedLanguages() {
    return [
      { code: 'en-IN', name: 'English (India)' },
      { code: 'hi-IN', name: 'Hindi (India)' },
      { code: 'en-US', name: 'English (US)' },
      { code: 'en-GB', name: 'English (UK)' }
    ];
  }
}

export const speechToTextService = new SpeechToTextService();