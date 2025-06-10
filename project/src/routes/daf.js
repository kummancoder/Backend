import express from 'express';
import Joi from 'joi';
import { DAF } from '../models/DAF.js';
import { auth } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// DAF validation schema
const dafSchema = Joi.object({
  personalInfo: Joi.object({
    name: Joi.string().required(),
    fatherName: Joi.string().required(),
    motherName: Joi.string().required(),
    dateOfBirth: Joi.date().required(),
    gender: Joi.string().valid('Male', 'Female', 'Other').required(),
    category: Joi.string().valid('General', 'OBC', 'SC', 'ST', 'EWS').required(),
    nationality: Joi.string().required(),
    religion: Joi.string().required(),
    maritalStatus: Joi.string().valid('Single', 'Married', 'Divorced', 'Widowed').required(),
    address: Joi.object({
      permanent: Joi.string().required(),
      correspondence: Joi.string().required(),
      state: Joi.string().required(),
      district: Joi.string().required(),
      pincode: Joi.string().pattern(/^\d{6}$/).required()
    }).required()
  }).required(),
  
  educationalQualifications: Joi.array().items(
    Joi.object({
      degree: Joi.string().required(),
      institution: Joi.string().required(),
      university: Joi.string().required(),
      yearOfPassing: Joi.number().integer().min(1950).max(new Date().getFullYear()).required(),
      percentage: Joi.number().min(0).max(100).required(),
      subjects: Joi.array().items(Joi.string()).required()
    })
  ).min(1).required(),
  
  workExperience: Joi.array().items(
    Joi.object({
      organization: Joi.string().required(),
      position: Joi.string().required(),
      duration: Joi.object({
        from: Joi.date().required(),
        to: Joi.date().allow(null)
      }).required(),
      responsibilities: Joi.string().required(),
      achievements: Joi.string().allow('')
    })
  ).default([]),
  
  hobbies: Joi.array().items(Joi.string()).min(1).required(),
  
  achievements: Joi.array().items(
    Joi.object({
      title: Joi.string().required(),
      description: Joi.string().required(),
      year: Joi.number().integer().min(1950).max(new Date().getFullYear()).required(),
      category: Joi.string().valid('Academic', 'Sports', 'Cultural', 'Social Service', 'Other').required()
    })
  ).default([]),
  
  optionalSubject: Joi.string().required(),
  
  preferences: Joi.object({
    servicePreferences: Joi.array().items(Joi.string()).min(1).required(),
    cadrePreferences: Joi.array().items(Joi.string()).default([]),
    reasonForJoining: Joi.string().required()
  }).required(),
  
  additionalInfo: Joi.object({
    languagesKnown: Joi.array().items(Joi.string()).min(1).required(),
    publications: Joi.array().items(Joi.string()).default([]),
    socialMediaHandles: Joi.object({
      twitter: Joi.string().allow(''),
      linkedin: Joi.string().allow(''),
      facebook: Joi.string().allow('')
    }).default({}),
    emergencyContact: Joi.object({
      name: Joi.string().required(),
      relation: Joi.string().required(),
      phone: Joi.string().pattern(/^\+?[\d\s-()]+$/).required()
    }).required()
  }).required()
});

// Submit DAF
router.post('/submit', auth, async (req, res) => {
  try {
    const { error, value } = dafSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    // Check if user already has a DAF
    const existingDAF = await DAF.findOne({ userId: req.user.id });
    if (existingDAF) {
      return res.status(400).json({
        success: false,
        message: 'DAF already submitted. Use update endpoint to modify.'
      });
    }

    const daf = new DAF({
      userId: req.user.id,
      ...value,
      submittedAt: new Date()
    });

    await daf.save();

    logger.info(`DAF submitted successfully for user: ${req.user.id}`);

    res.status(201).json({
      success: true,
      message: 'DAF submitted successfully',
      data: {
        dafId: daf._id,
        submittedAt: daf.submittedAt
      }
    });

  } catch (error) {
    logger.error('Error submitting DAF:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get DAF
router.get('/me', auth, async (req, res) => {
  try {
    const daf = await DAF.findOne({ userId: req.user.id });
    
    if (!daf) {
      return res.status(404).json({
        success: false,
        message: 'DAF not found'
      });
    }

    res.json({
      success: true,
      data: daf
    });

  } catch (error) {
    logger.error('Error fetching DAF:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update DAF
router.put('/update', auth, async (req, res) => {
  try {
    const { error, value } = dafSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const daf = await DAF.findOneAndUpdate(
      { userId: req.user.id },
      { 
        ...value,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!daf) {
      return res.status(404).json({
        success: false,
        message: 'DAF not found'
      });
    }

    logger.info(`DAF updated successfully for user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'DAF updated successfully',
      data: daf
    });

  } catch (error) {
    logger.error('Error updating DAF:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete DAF
router.delete('/delete', auth, async (req, res) => {
  try {
    const daf = await DAF.findOneAndDelete({ userId: req.user.id });
    
    if (!daf) {
      return res.status(404).json({
        success: false,
        message: 'DAF not found'
      });
    }

    logger.info(`DAF deleted successfully for user: ${req.user.id}`);

    res.json({
      success: true,
      message: 'DAF deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting DAF:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Validate DAF completeness
router.get('/validate', auth, async (req, res) => {
  try {
    const daf = await DAF.findOne({ userId: req.user.id });
    
    if (!daf) {
      return res.status(404).json({
        success: false,
        message: 'DAF not found'
      });
    }

    const validationResult = {
      isComplete: true,
      missingFields: [],
      warnings: []
    };

    // Check for required fields
    if (!daf.personalInfo?.name) validationResult.missingFields.push('Personal Info - Name');
    if (!daf.educationalQualifications?.length) validationResult.missingFields.push('Educational Qualifications');
    if (!daf.optionalSubject) validationResult.missingFields.push('Optional Subject');
    if (!daf.preferences?.servicePreferences?.length) validationResult.missingFields.push('Service Preferences');

    // Check for warnings
    if (!daf.workExperience?.length) validationResult.warnings.push('No work experience provided');
    if (!daf.achievements?.length) validationResult.warnings.push('No achievements provided');
    if (!daf.hobbies?.length) validationResult.warnings.push('No hobbies provided');

    validationResult.isComplete = validationResult.missingFields.length === 0;

    res.json({
      success: true,
      data: validationResult
    });

  } catch (error) {
    logger.error('Error validating DAF:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

export default router;