# 🍺 FREE BEER Transit Incentives - Troubleshooting Guide

## Common Issues & Solutions

### Database Issues
**Problem**: Prisma client errors or database connection issues
**Solution**: 
```bash
# Reset database and regenerate client
npm run db:reset
npm run db:generate
npm run db:seed
```

### API Errors
**Problem**: Beer rewards APIs returning errors
**Solution**: 
- Check environment variables in `.env.local`
- Verify Gemini API key is valid
- Use fallback demo messages (built-in)

### Component Import Errors
**Problem**: Cannot import beer reward components
**Solution**: 
- Verify all files are in correct `src/` location (not `src/src/`)
- Check TypeScript interfaces are properly exported
- Run `npm run build` to check for compilation errors

### Demo Reset
**Problem**: Demo users not in correct state
**Solution**:
```bash
npm run demo:reset
```

### Performance Issues
**Problem**: Slow AI nudge generation
**Solution**:
- Nudges are cached for 5 minutes
- Fallback templates used if AI fails
- Check network connectivity to Gemini API

## Quick Fixes

### Missing Beer Icon
If Beer icon from lucide-react is missing:
```typescript
// Fallback to GlassWater icon
import { GlassWater } from 'lucide-react';
```

### Environment Variables
Ensure these are set in `.env.local`:
```
GEMINI_API_KEY=your_key_here
DEMO_MODE_ENABLED=true
ENABLE_BEER_ANALYTICS=true
```

### TypeScript Errors
Common fixes:
```bash
# Clear TypeScript cache
rm -rf .next
npm run build
```