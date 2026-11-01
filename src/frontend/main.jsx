import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { OperationFeedbackProvider } from './OperationFeedback.jsx';
import './styles.css';
import './styles-extra.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><OperationFeedbackProvider><App /></OperationFeedbackProvider></React.StrictMode>);
