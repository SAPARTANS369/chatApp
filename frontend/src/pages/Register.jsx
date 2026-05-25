import React, { useState, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

const Register = () => {
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        password: '',
        display_name: ''
    });
    const [error, setError] = useState('');
    const { register, login } = useContext(AuthContext);
    const navigate = useNavigate();

    const handleChange = (e) => {
        setFormData({...formData, [e.target.name]: e.target.value});
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await register(formData.username, formData.email, formData.password, formData.display_name);
            await login(formData.username, formData.password);
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.error || 'Registration failed');
        }
    };

    return (
        <div className="form-container glass">
            <h2>Create Account</h2>
            {error && <div className="error-text">{error}</div>}
            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>Username</label>
                    <input 
                        type="text" 
                        name="username"
                        className="form-control" 
                        value={formData.username}
                        onChange={handleChange}
                        required
                    />
                </div>
                <div className="form-group">
                    <label>Display Name</label>
                    <input 
                        type="text" 
                        name="display_name"
                        className="form-control" 
                        value={formData.display_name}
                        onChange={handleChange}
                        required
                    />
                </div>
                <div className="form-group">
                    <label>Email</label>
                    <input 
                        type="email" 
                        name="email"
                        className="form-control" 
                        value={formData.email}
                        onChange={handleChange}
                        required
                    />
                </div>
                <div className="form-group">
                    <label>Password</label>
                    <input 
                        type="password" 
                        name="password"
                        className="form-control" 
                        value={formData.password}
                        onChange={handleChange}
                        required
                    />
                </div>
                <button type="submit" className="btn-primary">Sign Up</button>
            </form>
            <div className="switch-auth">
                Already have an account? <Link to="/login">Login</Link>
            </div>
        </div>
    );
};

export default Register;
