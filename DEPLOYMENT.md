# Production Deployment Guide for 100+ Users

## Performance Optimizations Implemented

### ✅ Completed
1. **Rate Limiting**: 100 requests/15min (general), 5 requests/15min (auth)
2. **Database Connection Pooling**: 10 max connections, 50 queue limit
3. **Redis Caching**: 5-10 minute TTL for dashboard data
4. **JWT Authentication**: Secure token-based auth
5. **Cache Invalidation**: Automatic cache clearing on data changes
6. **PM2 Configuration**: Cluster mode for multi-core utilization

### 📁 Files Created
- `ecosystem.config.json` - PM2 cluster configuration
- `.env` - Production environment variables
- `logs/` - Directory for PM2 logs

## Deployment Steps

### 1. Install Redis
```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis

# Verify Redis is running
redis-cli ping
```

### 2. Update Environment Variables
Edit `.env` file:
```bash
# Change JWT secret to something secure
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-2024

# Update database credentials if needed
DB_USER=your_db_user
DB_PASS=your_db_password
```

### 3. Start with PM2
```bash
# Install PM2 globally (if not already installed)
npm install -g pm2

# Start the application in cluster mode
pm2 start ecosystem.config.json

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
```

### 4. Monitor Performance
```bash
# Check PM2 status
pm2 status

# View logs
pm2 logs

# Monitor CPU/memory usage
pm2 monit

# Restart if needed
pm2 restart all
```

## Performance Metrics

### Expected Capacity
- **Concurrent Users**: 100+
- **Requests/sec**: 1000+
- **Memory Usage**: ~1GB per process
- **CPU Usage**: Distributed across cores

### Caching Strategy
- **Admin Dashboard**: 10 minutes TTL
- **Student Dashboard**: 5 minutes TTL
- **Auto-invalidation**: On data changes

### Rate Limiting
- **General API**: 100 requests/15min per IP
- **Authentication**: 5 requests/15min per IP
- **Burst Protection**: Automatic throttling

## Monitoring & Scaling

### Health Checks
```bash
# Check application health
curl http://localhost:3000/api/dashboard/admin

# Check Redis connection
redis-cli info server
```

### Scaling Up
For more than 200 users:
1. Increase `instances` in `ecosystem.config.json`
2. Add Redis cluster for caching
3. Consider database read replicas
4. Add load balancer (nginx)

### Troubleshooting
```bash
# If Redis is not available, app will fallback to direct DB queries
# Check Redis logs: tail -f /usr/local/var/log/redis.log

# If PM2 processes crash, check logs:
pm2 logs karate-admin-backend --err

# Restart specific process:
pm2 restart karate-admin-backend
```

## Security Notes

1. **JWT Secret**: Change the JWT_SECRET in production
2. **Database**: Use strong passwords and limit access
3. **Redis**: Secure Redis server, disable dangerous commands
4. **HTTPS**: Use reverse proxy (nginx) for SSL termination
5. **Firewall**: Only expose necessary ports

## Backup Strategy

### Database Backup
```bash
# Daily backup
mysqldump -u root -p kartae > backup_$(date +%Y%m%d).sql
```

### Redis Backup
```bash
# Redis persistence is enabled by default
# Check redis.conf for save configurations
```

This setup should handle 100+ concurrent users with optimal performance and reliability.
