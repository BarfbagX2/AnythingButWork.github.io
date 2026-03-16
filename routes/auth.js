const User = require('../models/User');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');

module.exports = function(app) {
    app.post('/api/auth/register', async (req, res) => {
        try {
            const { username, email, password } = req.body;
            let user = await User.findOne({ $or: [{ email }, { username }] });
            if (user) return res.status(400).json({ message: 'User already exists' });
            user = new User({ username, email, password });
            await user.save();
            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
            res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            let user = await User.findOne({ email });
            if (!user) return res.status(400).json({ message: 'User not found' });
            const isMatch = await user.comparePassword(password);
            if (!isMatch) return res.status(400).json({ message: 'Invalid password' });
            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
            user.status = 'online';
            await user.save();
            res.json({ token, user: { id: user._id, username: user.username, email: user.email, profilePicture: user.profilePicture, bio: user.bio } });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    });

    app.get('/api/auth/profile', auth, async (req, res) => {
        try {
            const user = await User.findById(req.userId).populate('friends');
            res.json(user);
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    });
};