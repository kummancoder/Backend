import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Interview } from '../models/Interview.js';
import { DAF } from '../models/DAF.js';
import { speechToTextService } from './speechToTextService.js';
import { textToSpeechService } from './textToSpeechService.js';
import { sentimentAnalysisService } from './sentimentAnalysisService.js';
import { questionGenerationService } from './questionGenerationService.js';
import logger from '../utils/logger.js';

class SocketService {
  constructor() {
    this.io = null;
    this.activeInterviews = new Map(); // Store active interview sessions
  }

  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    // Authentication middleware for socket connections
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = { id: decoded.userId, email: decoded.email };
        socket.userId = user.id;
        socket.user = user;
        
        logger.info(`Socket authenticated for user: ${user.id}`);
        next();
      } catch (error) {
        logger.error('Socket authentication failed:', error);
        next(new Error('Authentication failed'));
      }
    });

    this.io.on('connection', (socket) => {
      logger.info(`User connected: ${socket.userId}`);
      this.handleConnection(socket);
    });

    logger.info('Socket.IO service initialized');
  }

  handleConnection(socket) {
    // Join interview room
    socket.on('join_interview', async (data) => {
      try {
        const { interviewId } = data;
        
        // Verify interview belongs to user and is active
        const interview = await Interview.findOne({
          _id: interviewId,
          userId: socket.userId,
          status: 'in_progress'
        }).populate('dafId');

        if (!interview) {
          socket.emit('error', { message: 'Invalid or inactive interview session' });
          return;
        }

        // Join the interview room
        socket.join(`interview_${interviewId}`);
        
        // Store active interview session
        this.activeInterviews.set(socket.id, {
          interviewId,
          userId: socket.userId,
          interview,
          currentQuestionIndex: interview.questions.length,
          isProcessing: false
        });

        logger.info(`User ${socket.userId} joined interview ${interviewId}`);

        // Send welcome message and first question if needed
        if (interview.questions.length === 0) {
          await this.generateAndSendFirstQuestion(socket, interview);
        } else {
          // Send current state
          socket.emit('interview_state', {
            currentQuestion: interview.questions[interview.questions.length - 1],
            questionNumber: interview.questions.length,
            totalQuestions: interview.questions.length,
            timeElapsed: Math.round((new Date() - interview.startedAt) / 1000)
          });
        }

      } catch (error) {
        logger.error('Error joining interview:', error);
        socket.emit('error', { message: 'Failed to join interview session' });
      }
    });

    // Handle audio response from user
    socket.on('audio_response', async (data) => {
      try {
        const session = this.activeInterviews.get(socket.id);
        if (!session || session.isProcessing) {
          socket.emit('error', { message: 'Invalid session or already processing' });
          return;
        }

        session.isProcessing = true;
        const { audioData, questionId } = data;

        logger.info(`Processing audio response for user ${socket.userId}, question ${questionId}`);

        // Emit processing status
        socket.emit('processing_response', { status: 'transcribing' });

        // Convert speech to text
        const transcription = await speechToTextService.transcribeAudio(audioData);
        
        if (!transcription || transcription.trim().length === 0) {
          socket.emit('error', { message: 'Could not transcribe audio. Please try again.' });
          session.isProcessing = false;
          return;
        }

        socket.emit('processing_response', { 
          status: 'analyzing', 
          transcription: transcription 
        });

        // Analyze sentiment and emotion
        const sentimentAnalysis = await sentimentAnalysisService.analyzeSentiment(transcription);

        // Store the response
        const response = {
          questionId,
          transcription,
          sentiment: sentimentAnalysis,
          timestamp: new Date(),
          responseTime: data.responseTime || 0
        };

        // Update interview with response
        await Interview.findByIdAndUpdate(session.interviewId, {
          $push: { responses: response }
        });

        socket.emit('processing_response', { status: 'generating_question' });

        // Generate next question based on response and DAF
        const nextQuestion = await this.generateNextQuestion(session, transcription, sentimentAnalysis);

        if (nextQuestion) {
          // Convert question to speech
          const audioBuffer = await textToSpeechService.synthesizeSpeech(nextQuestion.text);

          // Store the question
          await Interview.findByIdAndUpdate(session.interviewId, {
            $push: { questions: nextQuestion }
          });

          session.currentQuestionIndex++;

          // Send the next question
          socket.emit('next_question', {
            question: nextQuestion,
            questionNumber: session.currentQuestionIndex + 1,
            audioBuffer: audioBuffer.toString('base64'),
            previousResponse: {
              transcription,
              sentiment: sentimentAnalysis
            }
          });

          logger.info(`Next question generated for user ${socket.userId}`);
        } else {
          // End interview if no more questions
          await this.endInterview(socket, session);
        }

        session.isProcessing = false;

      } catch (error) {
        logger.error('Error processing audio response:', error);
        socket.emit('error', { message: 'Failed to process response' });
        
        const session = this.activeInterviews.get(socket.id);
        if (session) {
          session.isProcessing = false;
        }
      }
    });

    // Handle manual interview end
    socket.on('end_interview', async () => {
      try {
        const session = this.activeInterviews.get(socket.id);
        if (session) {
          await this.endInterview(socket, session);
        }
      } catch (error) {
        logger.error('Error ending interview:', error);
        socket.emit('error', { message: 'Failed to end interview' });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      logger.info(`User disconnected: ${socket.userId}`);
      this.activeInterviews.delete(socket.id);
    });

    // Handle typing indicator (for text-based fallback)
    socket.on('typing', (data) => {
      const session = this.activeInterviews.get(socket.id);
      if (session) {
        socket.to(`interview_${session.interviewId}`).emit('user_typing', {
          userId: socket.userId,
          isTyping: data.isTyping
        });
      }
    });
  }

  async generateAndSendFirstQuestion(socket, interview) {
    try {
      const firstQuestion = await questionGenerationService.generateFirstQuestion(interview.dafId);
      
      // Convert to speech
      const audioBuffer = await textToSpeechService.synthesizeSpeech(firstQuestion.text);

      // Store the question
      await Interview.findByIdAndUpdate(interview._id, {
        $push: { questions: firstQuestion }
      });

      // Send to client
      socket.emit('first_question', {
        question: firstQuestion,
        questionNumber: 1,
        audioBuffer: audioBuffer.toString('base64'),
        panelists: interview.panelists
      });

      logger.info(`First question sent to user ${socket.userId}`);

    } catch (error) {
      logger.error('Error generating first question:', error);
      socket.emit('error', { message: 'Failed to generate first question' });
    }
  }

  async generateNextQuestion(session, previousResponse, sentimentAnalysis) {
    try {
      const { interview } = session;
      
      // Check if we should end the interview
      const timeElapsed = (new Date() - interview.startedAt) / (1000 * 60); // minutes
      const maxQuestions = 15; // Maximum questions per interview
      
      if (timeElapsed >= interview.duration || interview.questions.length >= maxQuestions) {
        return null; // End interview
      }

      // Generate next question
      const nextQuestion = await questionGenerationService.generateFollowUpQuestion({
        daf: interview.dafId,
        previousQuestions: interview.questions,
        previousResponse,
        sentimentAnalysis,
        interviewContext: {
          type: interview.type,
          difficulty: interview.difficulty,
          focusAreas: interview.focusAreas,
          currentQuestionNumber: interview.questions.length + 1
        }
      });

      return nextQuestion;

    } catch (error) {
      logger.error('Error generating next question:', error);
      throw error;
    }
  }

  async endInterview(socket, session) {
    try {
      // Update interview status
      await Interview.findByIdAndUpdate(session.interviewId, {
        status: 'completed',
        endedAt: new Date(),
        $set: {
          actualDuration: Math.round((new Date() - session.interview.startedAt) / (1000 * 60))
        }
      });

      // Leave the room
      socket.leave(`interview_${session.interviewId}`);

      // Remove from active sessions
      this.activeInterviews.delete(socket.id);

      // Notify client
      socket.emit('interview_ended', {
        interviewId: session.interviewId,
        totalQuestions: session.interview.questions.length + (session.currentQuestionIndex || 0),
        duration: Math.round((new Date() - session.interview.startedAt) / (1000 * 60))
      });

      logger.info(`Interview ended for user ${socket.userId}, interview ${session.interviewId}`);

    } catch (error) {
      logger.error('Error ending interview:', error);
      throw error;
    }
  }

  // Utility method to send message to specific interview room
  sendToInterview(interviewId, event, data) {
    this.io.to(`interview_${interviewId}`).emit(event, data);
  }

  // Get active interview count
  getActiveInterviewCount() {
    return this.activeInterviews.size;
  }
}

export const socketService = new SocketService();