import { NextRequest, NextResponse } from 'next/server';
import { requireWallet, requireAdmin, isAdminWallet } from '@/lib/auth/wallet-session';
import prisma from '@/prisma/prisma';
require('dotenv').config();

export async function POST(request: NextRequest) {
    try {

        const body = await request.json();
        const {
            wallet_address
        } = body;
    const authResult = requireWallet(request, wallet_address);
    if (authResult instanceof NextResponse) return authResult;


        const user = await prisma.mst_users.findUnique({
            where: {
                user_address: wallet_address
            },
        });

        if (!user) {
            return NextResponse.json(
                {
                    message: 'User not found',
                    data: user
                },
                { status: 400 }
            );
        }

        if (user.user_trigger_event != "Y") {
            await prisma.mst_users.update({
                where: {
                    user_address: wallet_address
                },
                data: {
                    user_trigger_event: "Y"
                }
            })
        }

        return NextResponse.json(
            {
                message: 'Update successfully',
                data: user
            },
            { status: 200 }
        );
    } catch (error) {
        console.error('Update Error:', error);
        return NextResponse.json(
            {
                message: 'Failed to Update',
                error: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}