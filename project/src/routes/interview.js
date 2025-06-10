import express from 'express';
import Joi from 'joi';
import { Interview } from '../models/Interview.js';
import { DAF } from '../models/DAF.js';
import { auth } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Start interview validation schema
const startInterviewSchema = Joi.object({
  type: Joi.string().valid('mock', 'practice').default('mock'),
  duration: Joi.number().integer().min(15).max(60).default(30), // minutes
  difficulty: Joi.string().valid('easy', 'medium', 'hard').default('medium'),
  focusAreas: Joi.array().items(Joi.string()).default([])
});

// Start new interview session
router.post('/start', auth, async (req, res) => {
  try {
    const { error, value } = startInterviewSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    // Check if user has submitted DAF
    const daf = await DAF.findOne({ userId: req.user.id });
    if (!daf) {
      return res.status(400).json({
        success: false,
        message: 'Please submit your DAF before starting an interview'
      });
    }

    // Check for any ongoing interview
    const ongoingInterview = await Interview.findOne({
      userId: req.user.id,
      status: 'in_progress'
    });

    if (ongoingInterview) {
      return res.status(400).json({
        success: false,
        message: 'You have an ongoing interview. Please complete it first.',
        data: {
          interviewId: ongoingInterview._id,
          startedAt: ongoingInterview.startedAt
        }
      });
    }

    // Create new interview session
    const interview = new Interview({
      userId: req.user.id,
      dafId: daf._id,
      type: value.type,
      duration: value.duration,
      difficulty: value.difficulty,
      focusAreas: value.focusAreas,
      status: 'in_progress',
      startedAt: new Date(),
      questions: [],
      responses: [],
      panelists: [
        {
          name: 'Dr. Rajesh Kumar',
          role: 'Chairman',
          expertise: ['Public Administration', 'Ethics']
        },
        {
          name: 'Ms. Priya Sharma',
          role: 'Member',
          expertise: ['Current Affairs', 'Social Issues']
        },
        {
          name: 'Mr. Amit Singh',
          role: 'Member',
          expertise: ['Economics', 'Policy Analysis']
        }
      ]
    });

    await interview.save();

    logger.info(`Interview started for user: ${req.user.id}, Interview ID: ${interview._id}`);

    res.status(201).json({
      success: true,
      message: 'Interview session started successfully',
      data: {
        interviewId: interview._id,
        sessionToken: interview._id, // In production, use JWT or secure token
        startedAt: interview.startedAt,
        duration: interview.duration,
        panelists: interview.panelists
      }
    });

  } catch (error) {
    logger.error('Error starting interview:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get interview details
router.get('/:interviewId', auth, async (req, res) => {
  try {
    const interview = await Interview.findOne({
      _id: req.params.interviewId,
      userId: req.user.id
    }).populate('dafId', 'personalInfo.name optionalSubject');

    if (!interview) {
      return res.status(404).json({
        success: false,
        message: 'Interview not found'
      });
    }

    res.json({
      success: true,
      data: interview
    });

  } catch (error) {
    logger.error('Error fetching interview:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// End interview session
router.post('/:interviewId/end', auth, async (req, res) => {
  try {
    const interview = await Interview.findOne({
      _id: req.params.interviewId,
      userId: req.user.id,
      status: 'in_progress'
    });

    if (!interview) {
      return res.status(404).json({
        success: false,
        message: 'Active interview session not found'
      });
    }

    // Update interview status
    interview.status = 'completed';
    interview.endedAt = new Date();
    interview.actualDuration = Math.round((interview.endedAt - interview.startedAt) / (1000 * 60)); // minutes

    await interview.save();

    logger.info(`Interview ended for user: ${req.user.id}, Interview ID: ${interview._id}`);

    res.json({
      success: true,
      message: 'Interview session ended successfully',
      data: {
        interviewId: interview._id,
        endedAt: interview.endedAt,
        actualDuration: interview.actualDuration,
        totalQuestions: interview.questions.length,
        totalResponses: interview.responses.length
      }
    });

  } catch (error) {
    logger.error('Error ending interview:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get user's interview history
router.get('/history/me', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const interviews = await Interview.find({ userId: req.user.id })
      .select('type difficulty status startedAt endedAt actualDuration questions responses')
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Interview.countDocuments({ userId: req.user.id });

    const interviewsWithStats = interviews.map(interview => ({
      ...interview.toObject(),
      stats: {
        totalQuestions: interview.questions.length,
        totalResponses: interview.responses.length,
        averageResponseTime: interview.responses.length > 0 
          ? interview.responses.reduce((sum, r) => sum + (r.responseTime || 0), 0) / interview.responses.length 
          : 0
      }
    }));

    res.json({
      success: true,
      data: {
        interviews: interviewsWithStats,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching interview history:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get interview statistics
router.get('/stats/me', auth, async (req, res) => {
  try {
    const stats = await Interview.aggregate([
      { $match: { userId: req.user.id } },
      {
        $group: {
          _id: null,
          totalInterviews: { $sum: 1 },
          completedInterviews: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          totalQuestions: { $sum: { $size: '$questions' } },
          totalResponses: { $sum: { $size: '$responses' } },
          averageDuration: { $avg: '$actualDuration' },
          totalTimeSpent: { $sum: '$actualDuration' }
        }
      }
    ]);

    const result = stats[0] || {
      totalInterviews: 0,
      completedInterviews: 0,
      totalQuestions: 0,
      totalResponses: 0,
      averageDuration: 0,
      totalTimeSpent: 0
    };

    // Get performance trends (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentInterviews = await Interview.find({
      userId: req.user.id,
      startedAt: { $gte: thirtyDaysAgo },
      status: 'completed'
    }).select('startedAt actualDuration questions responses');

    res.json({
      success: true,
      data: {
        overall: result,
        recent: {
          count: recentInterviews.length,
          averageDuration: recentInterviews.length > 0 
            ? recentInterviews.reduce((sum, i) => sum + (i.actualDuration || 0), 0) / recentInterviews.length 
            : 0,
          totalQuestions: recentInterviews.reduce((sum, i) => sum + i.questions.length, 0),
          totalResponses: recentInterviews.reduce((sum, i) => sum + i.responses.length, 0)
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching interview statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;