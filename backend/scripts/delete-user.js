const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function deleteUser(email) {
  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      console.log('User not found:', email);
      process.exit(0);
    }

    // Delete company membership
    await prisma.companyMembership.deleteMany({
      where: { userId: user.id },
    });

    // Delete the user
    await prisma.user.delete({
      where: { id: user.id },
    });

    console.log('✓ User deleted:', email);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

const email = process.argv[2];

if (!email) {
  console.error('Usage: node delete-user.js <email>');
  process.exit(1);
}

deleteUser(email);
