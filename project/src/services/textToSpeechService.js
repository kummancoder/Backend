import textToSpeech from '@google-cloud/text-to-speech';
import logger from '../utils/logger.js';

class TextToSpeechService {
  constructor() {
    this.client = new textToSpeech.TextToSpeechClient({
      keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE,
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
    });

    // Define available voices for different panelists
    this.voices = {
      chairman: {
        languageCode: 'en-IN',
        name: 'en-IN-Wavenet-B', // Male voice
        ssmlGender: 'MALE'
      },
      member1: {
        languageCode: 'en-IN',
        name: 'en-IN-Wavenet-A', // Female voice
        ssmlGender: 'FEMALE'
      },
      member2: {
        languageCode: 'en-IN',
        name: 'en-IN-Wavenet-C', // Male voice
        ssmlGender: 'MALE'
      },
      default: {
        languageCode: 'en-IN',
        name: 'en-IN-Wavenet-D', // Female voice
        ssmlGender: 'FEMALE'
      }
    };
  }

  async synthesizeSpeech(text, options = {}) {
    try {
      if (!text || text.trim().length === 0) {
        throw new Error('Text is required for speech synthesis');
      }

      // Clean and prepare text
      const cleanText = this.prepareTextForSpeech(text);

      // Select voice based on panelist or use default
      const voice = this.voices[options.panelist] || this.voices.default;

      const request = {
        input: { text: cleanText },
        voice: {
          languageCode: voice.languageCode,
          name: voice.name,
          ssmlGender: voice.ssmlGender
        },
        audioConfig: {
          audioEncoding: options.encoding || 'MP3',
          speakingRate: options.speakingRate || 0.9, // Slightly slower for clarity
          pitch: options.pitch || 0.0,
          volumeGainDb: options.volumeGain || 0.0,
          effectsProfileId: ['telephony-class-application']
        },
      };

      const [response] = await this.client.synthesizeSpeech(request);

      logger.info(`Speech synthesized successfully. Text length: ${cleanText.length}, Voice: ${voice.name}`);

      return response.audioContent;

    } catch (error) {
      logger.error('Error in text-to-speech conversion:', error);
      throw new Error('Failed to synthesize speech');
    }
  }

  async synthesizeSSML(ssmlText, options = {}) {
    try {
      if (!ssmlText || ssmlText.trim().length === 0) {
        throw new Error('SSML text is required for speech synthesis');
      }

      const voice = this.voices[options.panelist] || this.voices.default;

      const request = {
        input: { ssml: ssmlText },
        voice: {
          languageCode: voice.languageCode,
          name: voice.name,
          ssmlGender: voice.ssmlGender
        },
        audioConfig: {
          audioEncoding: options.encoding || 'MP3',
          speakingRate: options.speakingRate || 0.9,
          pitch: options.pitch || 0.0,
          volumeGainDb: options.volumeGain || 0.0,
          effectsProfileId: ['telephony-class-application']
        },
      };

      const [response] = await this.client.synthesizeSpeech(request);

      logger.info(`SSML speech synthesized successfully. Voice: ${voice.name}`);

      return response.audioContent;

    } catch (error) {
      logger.error('Error in SSML text-to-speech conversion:', error);
      throw new Error('Failed to synthesize SSML speech');
    }
  }

  prepareTextForSpeech(text) {
    // Clean and prepare text for better speech synthesis
    return text
      .replace(/\n+/g, '. ') // Replace newlines with periods
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/([.!?])\s*([A-Z])/g, '$1 $2') // Ensure proper spacing after punctuation
      .replace(/\b(Mr|Mrs|Ms|Dr|Prof)\./g, '$1') // Remove periods from titles
      .replace(/\b(etc|vs|eg|ie)\./g, '$1') // Remove periods from common abbreviations
      .trim();
  }

  createSSMLForQuestion(question, panelist = 'default', options = {}) {
    const pauseShort = '<break time="0.5s"/>';
    const pauseMedium = '<break time="1s"/>';
    const pauseLong = '<break time="1.5s"/>';

    // Add appropriate pauses and emphasis for interview questions
    let ssml = '<speak>';
    
    // Add greeting if it's the first question
    if (options.isFirstQuestion) {
      ssml += `Good ${this.getTimeOfDay()}, candidate.${pauseMedium}`;
    }

    // Add the question with appropriate pauses
    ssml += `<prosody rate="0.9" pitch="+0st">${question}</prosody>`;
    
    // Add closing pause
    ssml += pauseLong;
    
    ssml += '</speak>';

    return ssml;
  }

  getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }

  // Get available voices
  async getAvailableVoices() {
    try {
      const [result] = await this.client.listVoices({
        languageCode: 'en-IN'
      });

      return result.voices.map(voice => ({
        name: voice.name,
        languageCode: voice.languageCodes[0],
        ssmlGender: voice.ssmlGender,
        naturalSampleRateHertz: voice.naturalSampleRateHertz
      }));

    } catch (error) {
      logger.error('Error fetching available voices:', error);
      return Object.values(this.voices);
    }
  }

  // Validate text length for TTS
  validateTextLength(text) {
    const maxLength = 5000; // Google TTS limit
    if (text.length > maxLength) {
      return {
        valid: false,
        error: `Text too long. Maximum ${maxLength} characters allowed.`,
        actualLength: text.length
      };
    }
    return { valid: true };
  }
}

export const textToSpeechService = new TextToSpeechService();