import bcrypt from 'bcryptjs';

// Generate password hashes for the three accounts
const accounts = [
  { email: 'volunteer@iitb.ac.in', password: 'Volunteer@123' },
  { email: 'instructor@iitb.ac.in', password: 'Instructor@123' },
  { email: 'associate.instructor@iitb.ac.in', password: 'Associate@123' }
];

console.log('\n=== PASSWORD HASHES FOR SUPABASE ===\n');

accounts.forEach(account => {
  const hash = bcrypt.hashSync(account.password, 10);
  console.log(`Email: ${account.email}`);
  console.log(`Password: ${account.password}`);
  console.log(`Hash: ${hash}`);
  console.log('---\n');
});

console.log('Copy the hash values and paste them in Supabase User table passwordHash column\n');
